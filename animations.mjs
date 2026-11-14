import fs from 'node:fs';
import path from 'node:path';

const USERNAME = process.env.GH_USERNAME || 'Qwarwin4';
const TOKEN = process.env.GH_TOKEN;
const INCLUDE_FORKS = process.env.INCLUDE_FORKS === 'true';
const LANGUAGE_SLOTS = 12;
const GRAPHQL_URL = 'https://api.github.com/graphql';

if (!TOKEN) {
  console.error('Ошибка: не задан GH_TOKEN');
  process.exit(1);
}

const currentYear = new Date().getFullYear();
const fromDate = `${currentYear}-01-01T00:00:00Z`;
const forkFilter = INCLUDE_FORKS ? '' : 'isFork: false, ';

// без privacy: PUBLIC — считаем все репозитории, которые видит токен (включая приватные)
const reposQuery = `
query($login: String!, $from: GitTimestamp!, $cursor: String) {
  user(login: $login) {
    repositories(first: 100, after: $cursor, ${forkFilter}ownerAffiliations: OWNER) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        isPrivate
        stargazerCount
        pullRequests(first: 1) { totalCount }
        issues(first: 1) { totalCount }
        defaultBranchRef {
          target {
            ... on Commit {
              history(since: $from) { totalCount }
            }
          }
        }
        languages(first: 100, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
  }
}
`;

const userQuery = `
query($login: String!, $from: DateTime!, $prQuery: String!, $issueQuery: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection(from: $from) {
      totalRepositoriesWithContributedCommits
    }
  }
  prSearch: search(query: $prQuery, type: ISSUE, first: 1) { issueCount }
  issueSearch: search(query: $issueQuery, type: ISSUE, first: 1) { issueCount }
}
`;

async function gql(query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors || !result.data?.user) {
    console.error('Ошибка GitHub GraphQL API:', result.errors || result.message || response.statusText);
    process.exit(1);
  }
  return result.data;
}

async function getStats() {
  let cursor = null;
  let totalRepos = 0;
  let totalStars = 0;
  let commits = 0;
  let prs = 0;
  let issues = 0;
  const languages = new Map();

  do {
    const { user } = await gql(reposQuery, { login: USERNAME, from: fromDate, cursor });
    const repositories = user.repositories;
    for (const repo of repositories.nodes) {
      commits += repo.defaultBranchRef?.target?.history?.totalCount || 0;
      prs += repo.pullRequests.totalCount;
      issues += repo.issues.totalCount;
      if (repo.isPrivate) continue;
      totalRepos++;
      totalStars += repo.stargazerCount;
      for (const { size, node } of repo.languages.edges) {
        const existing = languages.get(node.name) || { size: 0, color: node.color || '#24e500' };
        existing.size += size;
        if (node.color) existing.color = node.color;
        languages.set(node.name, existing);
      }
    }
    cursor = repositories.pageInfo.hasNextPage ? repositories.pageInfo.endCursor : null;
  } while (cursor);

  const data = await gql(userQuery, {
    login: USERNAME,
    from: fromDate,
    prQuery: `author:${USERNAME} is:pr -user:${USERNAME}`,
    issueQuery: `author:${USERNAME} is:issue -user:${USERNAME}`,
  });
  const followers = data.user.followers.totalCount;
  const contributedTo = data.user.contributionsCollection.totalRepositoriesWithContributedCommits;
  prs += data.prSearch.issueCount || 0;
  issues += data.issueSearch.issueCount || 0;

  return { totalRepos, totalStars, followers, commits, prs, issues, contributedTo, languages };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
}

const stats = await getStats();
const { totalRepos, totalStars, followers, commits, prs, issues, contributedTo } = stats;
const allLanguageBytes = [...stats.languages.values()].reduce((sum, language) => sum + language.size, 0) || 1;
const topLanguages = [...stats.languages.entries()]
  .map(([name, data]) => ({ name, size: data.size, color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : '#24e500' }))
  .sort((a, b) => b.size - a.size)
  .slice(0, LANGUAGE_SLOTS);

console.log(`Репозиториев учтено: ${totalRepos}`);
console.log(`Топ языков: ${topLanguages.map(({ name, size }) => `${name} ${size}`).join(', ') || 'нет данных'}`);

const expCdf = (value) => 1 - Math.pow(2, -value);
const logCdf = (value) => value / (1 + value);
const weightedScore = 3 * expCdf(commits / 250) + 3 * expCdf(prs / 50) + expCdf(issues / 25) +
  2 * logCdf(totalStars / 50) + logCdf(followers / 10);
const score = Math.round((weightedScore / 10) * 100);
let rank = 'C';
if (score >= 99) rank = 'S';
else if (score >= 87.5) rank = 'A+';
else if (score >= 75) rank = 'A';
else if (score >= 62.5) rank = 'A-';
else if (score >= 50) rank = 'B+';
else if (score >= 37.5) rank = 'B';
else if (score >= 25) rank = 'B-';
else if (score >= 12.5) rank = 'C+';

const circumference = 2 * Math.PI * 46;
const progress = score / 100 * circumference;
const barWidth = 744;
let barX = 28;
const languageBars = topLanguages.map((language) => {
  const width = language.size / allLanguageBytes * barWidth;
  const rect = `<rect x="${barX.toFixed(2)}" y="408" width="${width.toFixed(2)}" height="12" fill="${language.color}"/>`;
  barX += width;
  return rect;
}).join('\n    ');
const languageRow = (language, index) => {
  const x = index < 6 ? 28 : 410;
  const row = index % 6;
  const percent = (language.size / allLanguageBytes * 100).toFixed(1);
  return `<g class="fade" style="animation-delay:${(1.05 + index * 0.08).toFixed(2)}s"><circle cx="${x}" cy="${448 + row * 22}" r="5" fill="${language.color}"/><text x="${x + 14}" y="${453 + row * 22}" class="lang-text">${escapeXml(language.name)} ${percent}%</text></g>`;
};
const leftLanguages = topLanguages.slice(0, 6).map(languageRow).join('\n');
const rightLanguages = topLanguages.slice(6).map((language, index) => languageRow(language, index + 6)).join('\n');

const svg = `<svg width="800" height="590" viewBox="0 0 800 590" fill="none" xmlns="http://www.w3.org/2000/svg">
<style>
.title{font:600 22px 'Segoe UI',Ubuntu,Sans-Serif;fill:#24e500}.section-title{font:700 18px 'Segoe UI',Ubuntu,Sans-Serif;fill:#24e500}.metric-label{font:400 13px 'Segoe UI',Ubuntu,Sans-Serif;fill:#8b949e}.metric-value{font:700 28px 'Segoe UI',Ubuntu,Sans-Serif;fill:#24e500}.stat-label{font:600 14px 'Segoe UI',Ubuntu,Sans-Serif;fill:#e6edf3}.stat-value{font:700 14px 'Segoe UI',Ubuntu,Sans-Serif;fill:#e6edf3}.rank-text{font:700 30px 'Segoe UI',Ubuntu,Sans-Serif;fill:#fff}.score-text{font:600 12px 'Segoe UI',Ubuntu,Sans-Serif;fill:#8b949e}.lang-text{font:400 13px 'Segoe UI',Ubuntu,Sans-Serif;fill:#e6edf3}.divider{stroke:#1f6f12;stroke-width:1}.fade{opacity:0;animation:fade-in .7s ease-out forwards}.ring{stroke-dasharray:0 ${circumference.toFixed(1)};animation:ring-fill 1.8s .4s cubic-bezier(.2,.7,.2,1) forwards}.rank-text{animation:rank-pulse 3s 2.5s ease-in-out infinite}.bar-reveal{width:0;animation:bar-grow 1.5s .7s cubic-bezier(.2,.7,.2,1) forwards}@keyframes fade-in{to{opacity:1}}@keyframes ring-fill{to{stroke-dasharray:${progress.toFixed(1)} ${circumference.toFixed(1)}}}@keyframes bar-grow{to{width:${barWidth}px}}@keyframes rank-pulse{50%{opacity:.6}}@media(prefers-reduced-motion:reduce){.fade,.ring,.rank-text,.bar-reveal{animation:none;opacity:1}}
</style>
<defs><clipPath id="bar-clip"><rect x="28" y="408" height="12" rx="6" class="bar-reveal"/></clipPath></defs>
<rect x="1" y="1" width="798" height="588" rx="18" fill="#070a0e" stroke="#24e500" stroke-width="1.5"/><text x="28" y="42" class="title fade">${escapeXml(USERNAME)} · GitHub Stats</text><line x1="28" y1="60" x2="772" y2="60" class="divider"/>
<g class="fade" style="animation-delay:.1s"><text x="28" y="92" class="metric-label">PUBLIC REPOSITORIES</text><text x="28" y="130" class="metric-value">${totalRepos}</text></g><g class="fade" style="animation-delay:.25s"><text x="285" y="92" class="metric-label">TOTAL STARS</text><text x="285" y="130" class="metric-value">${totalStars}</text></g><g class="fade" style="animation-delay:.4s"><text x="540" y="92" class="metric-label">FOLLOWERS</text><text x="540" y="130" class="metric-value">${followers}</text></g>
<line x1="28" y1="152" x2="772" y2="152" class="divider"/><g transform="translate(28 174)"><g class="fade" style="animation-delay:.4s"><text y="13" class="stat-label">Total Stars Earned:</text><text x="245" y="13" class="stat-value">${totalStars}</text></g><g class="fade" style="animation-delay:.52s" transform="translate(0 30)"><text y="13" class="stat-label">Total Commits (${currentYear}):</text><text x="245" y="13" class="stat-value">${commits}</text></g><g class="fade" style="animation-delay:.64s" transform="translate(0 60)"><text y="13" class="stat-label">Total PRs:</text><text x="245" y="13" class="stat-value">${prs}</text></g><g class="fade" style="animation-delay:.76s" transform="translate(0 90)"><text y="13" class="stat-label">Total Issues:</text><text x="245" y="13" class="stat-value">${issues}</text></g><g class="fade" style="animation-delay:.88s" transform="translate(0 120)"><text y="13" class="stat-label">Contributed to (this year):</text><text x="245" y="13" class="stat-value">${contributedTo}</text></g><g transform="translate(560 68)"><circle r="46" stroke="#0f3809" stroke-width="7"/><circle r="46" stroke="#24e500" stroke-width="7" class="ring" stroke-linecap="round" transform="rotate(-90)"/><text y="5" text-anchor="middle" class="rank-text">${rank}</text><text y="23" text-anchor="middle" class="score-text">${score}/100</text></g></g>
<line x1="28" y1="330" x2="772" y2="330" class="divider"/><text x="28" y="364" class="section-title">Most Used Languages</text><g clip-path="url(#bar-clip)">${languageBars}</g><g>${leftLanguages}</g><g>${rightLanguages}</g></svg>`;

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync(path.join('assets', 'stats.svg'), svg);

// новый v-параметр заставляет camo перезагрузить картинку вместо кэша
if (fs.existsSync('README.md')) {
  const readme = fs.readFileSync('README.md', 'utf8');
  fs.writeFileSync('README.md', readme.replace(/stats\.svg(\?[^)"\s]*)?/, `stats.svg?v=${Date.now()}`));
}

console.log(`assets/stats.svg обновлен; оценка ${score}/100 (${rank}).`);
