import fs from 'fs';
import path from 'path';

const USERNAME = process.env.GH_USERNAME || 'Qwarwin4';
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.error('Ошибка: не задан GH_TOKEN');
  process.exit(1);
}

const currentYear = new Date().getFullYear();
const fromDate = `${currentYear}-01-01T00:00:00Z`;

const query = `
query($login: String!, $from: DateTime!) {
  user(login: $login) {
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges {
            size
            node { name color }
          }
        }
      }
    }
    contributionsCollection(from: $from) {
      totalCommitContributions
      restrictedContributionsCount
      totalRepositoriesWithContributedCommits
    }
    pullRequests(first: 1) { totalCount }
    openIssues: issues(states: OPEN) { totalCount }
    closedIssues: issues(states: CLOSED) { totalCount }
  }
}
`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query, variables: { login: USERNAME, from: fromDate } }),
});

const json = await res.json();
if (json.errors) {
  console.error(json.errors);
  process.exit(1);
}

const user = json.data.user;
const publicRepos = user.repositories.totalCount;
const followers = user.followers.totalCount;
const totalStars = user.repositories.nodes.reduce((acc, r) => acc + r.stargazerCount, 0);

const commits =
  user.contributionsCollection.totalCommitContributions +
  user.contributionsCollection.restrictedContributionsCount;
const prs = user.pullRequests.totalCount;
const issues = user.openIssues.totalCount + user.closedIssues.totalCount;
const contributedTo = user.contributionsCollection.totalRepositoriesWithContributedCommits;

const expCdf = (x) => 1 - Math.pow(2, -x);
const logNormalCdf = (x) => x / (1 + x);

const COMP_WEIGHT = 2 * expCdf(commits / 250) +
                    3 * expCdf(prs / 50) +
                    1 * expCdf(issues / 25) +
                    4 * logNormalCdf(totalStars / 50) +
                    1 * logNormalCdf(followers / 10);

const percentile = 100 - (COMP_WEIGHT / 11) * 100;

let rank = 'C';
if (percentile <= 1) rank = 'S';
else if (percentile <= 12.5) rank = 'A+';
else if (percentile <= 25) rank = 'A';
else if (percentile <= 37.5) rank = 'A-';
else if (percentile <= 50) rank = 'B+';
else if (percentile <= 62.5) rank = 'B';
else if (percentile <= 75) rank = 'B-';
else if (percentile <= 87.5) rank = 'C+';

const circumference = 2 * Math.PI * 46;
const progress = ((100 - percentile) / 100) * circumference;

const langMap = new Map();
for (const repo of user.repositories.nodes) {
  for (const edge of repo.languages.edges) {
    const { name, color } = edge.node;
    const prev = langMap.get(name) || { size: 0, color: color || '#24e500' };
    prev.size += edge.size;
    langMap.set(name, prev);
  }
}

const topLangs = [...langMap.entries()]
  .map(([name, data]) => ({ name, color: data.color, size: data.size }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);

const top5Total = topLangs.reduce((acc, l) => acc + l.size, 0) || 1;
topLangs.forEach((l) => {
  l.pct = ((l.size / top5Total) * 100).toFixed(2);
  l.width = (l.size / top5Total) * 744;
});

let currentX = 28;
const barRects = topLangs
  .map((l) => {
    const rect = `<rect x="${currentX.toFixed(1)}" y="382" width="${l.width.toFixed(1)}" height="12" fill="${l.color}"/>`;
    currentX += l.width;
    return rect;
  })
  .join('\n    ');

const langRow = (l, idx, n) => `
    <g class="fade" style="animation-delay: ${(1.2 + (n + idx) * 0.12).toFixed(2)}s">
      <circle cx="6" cy="${-5 + idx * 28}" r="6" fill="${l.color}"/>
      <text x="22" y="${idx * 28}" class="lang-text">${l.name} ${l.pct}%</text>
    </g>`;

const leftCol = topLangs.slice(0, 3).map((l, i) => langRow(l, i, 0)).join('');
const rightCol = topLangs.slice(3, 5).map((l, i) => langRow(l, i, 3)).join('');

const svg = `<svg width="800" height="520" viewBox="0 0 800 520" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font: 600 22px 'Segoe UI', Ubuntu, Sans-Serif; fill: #24e500; }
    .section-title { font: 700 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: #24e500; }
    .metric-label { font: 400 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
    .metric-value { font: 700 28px 'Segoe UI', Ubuntu, Sans-Serif; fill: #24e500; }
    .stat-label { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; }
    .stat-value { font: 700 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; }
    .rank-text { font: 700 30px 'Segoe UI', Ubuntu, Sans-Serif; fill: #ffffff; }
    .lang-text { font: 400 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6edf3; }
    .footer { font: 400 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #24e500; }
    .divider { stroke: #1f6f12; stroke-width: 1; }

    .fade { opacity: 0; animation: fade-in 0.7s ease-out forwards; }
    .ring { stroke-dasharray: 0 289; animation: ring-fill 1.8s 0.5s cubic-bezier(.2,.7,.2,1) forwards; }
    .rank-text { animation: rank-pulse 3s 2.5s ease-in-out infinite; }
    .bar-reveal { width: 0; animation: bar-grow 1.5s 0.8s cubic-bezier(.2,.7,.2,1) forwards; }

    @keyframes fade-in { to { opacity: 1; } }
    @keyframes ring-fill { to { stroke-dasharray: ${progress.toFixed(1)} 289; } }
    @keyframes bar-grow { to { width: 744px; } }
    @keyframes rank-pulse { 50% { opacity: 0.6; } }
  </style>

  <defs>
    <clipPath id="bar-clip">
      <rect x="28" y="382" height="12" rx="6" class="bar-reveal"/>
    </clipPath>
  </defs>

  <rect x="1" y="1" width="798" height="518" rx="18" fill="#070a0e" stroke="#24e500" stroke-width="1.5"/>

  <text x="28" y="42" class="title fade">${USERNAME} · GitHub Stats</text>
  <line x1="28" y1="60" x2="772" y2="60" class="divider"/>

  <g class="fade" style="animation-delay: 0.10s">
    <text x="28" y="92" class="metric-label">PUBLIC REPOSITORIES</text>
    <text x="28" y="130" class="metric-value">${publicRepos}</text>
  </g>

  <g class="fade" style="animation-delay: 0.25s">
    <text x="285" y="92" class="metric-label">TOTAL STARS</text>
    <text x="285" y="130" class="metric-value">${totalStars}</text>
  </g>

  <g class="fade" style="animation-delay: 0.40s">
    <text x="540" y="92" class="metric-label">FOLLOWERS</text>
    <text x="540" y="130" class="metric-value">${followers}</text>
  </g>

  <line x1="28" y1="152" x2="772" y2="152" class="divider"/>

  <g transform="translate(28, 174)">
    <g class="fade" style="animation-delay: 0.40s" transform="translate(0, 0)">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z" fill="#24e500"/>
      <text x="28" y="13" class="stat-label">Total Stars Earned:</text>
      <text x="270" y="13" class="stat-value">${totalStars}</text>
    </g>

    <g class="fade" style="animation-delay: 0.52s" transform="translate(0, 30)">
      <path d="M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0ZM8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm.5 4.75a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 .471.696l2.5 1a.75.75 0 0 0 .557-1.392L8.5 7.742V4.75Z" fill="#24e500"/>
      <text x="28" y="13" class="stat-label">Total Commits (${currentYear}):</text>
      <text x="270" y="13" class="stat-value">${commits}</text>
    </g>

    <g class="fade" style="animation-delay: 0.64s" transform="translate(0, 60)">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" fill="#24e500"/>
      <text x="28" y="13" class="stat-label">Total PRs:</text>
      <text x="270" y="13" class="stat-value">${prs}</text>
    </g>

    <g class="fade" style="animation-delay: 0.76s" transform="translate(0, 90)">
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="#24e500"/>
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" fill="#24e500"/>
      <text x="28" y="13" class="stat-label">Total Issues:</text>
      <text x="270" y="13" class="stat-value">${issues}</text>
    </g>

    <g class="fade" style="animation-delay: 0.88s" transform="translate(0, 120)">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" fill="#24e500"/>
      <text x="28" y="13" class="stat-label">Contributed to (last year):</text>
      <text x="270" y="13" class="stat-value">${contributedTo}</text>
    </g>

    <g transform="translate(560, 68)">
      <circle cx="0" cy="0" r="46" stroke="#0f3809" stroke-width="7" fill="none"/>
      <circle cx="0" cy="0" r="46" stroke="#24e500" stroke-width="7" class="ring" stroke-linecap="round" transform="rotate(-90)" fill="none"/>
      <text x="0" y="11" text-anchor="middle" class="rank-text">${rank}</text>
    </g>
  </g>

  <line x1="28" y1="330" x2="772" y2="330" class="divider"/>

  <text x="28" y="364" class="section-title">Most Used Languages</text>

  <g clip-path="url(#bar-clip)">
    ${barRects}
  </g>

  <g transform="translate(28, 420)">${leftCol}
  </g>

  <g transform="translate(300, 420)">${rightCol}
  </g>

  <line x1="28" y1="484" x2="772" y2="484" class="divider"/>
  <text x="28" y="506" class="footer fade" style="animation-delay: 1.8s">github.com/${USERNAME}</text>
</svg>`;

fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync(path.join('assets', 'stats.svg'), svg);
console.log('assets/stats.svg успешно обновлен!');
