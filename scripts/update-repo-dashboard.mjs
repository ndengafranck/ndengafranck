import { writeFile } from "node:fs/promises";

const username = process.env.GITHUB_USERNAME || "ndengafranck";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const apiRoot = "https://api.github.com";
const pageSize = 100;

if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(username)) {
  throw new Error(`Invalid GitHub username: ${username}`);
}

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ndengafranck-repository-dashboard",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function getGitHubJson(path) {
  const response = await fetch(`${apiRoot}${path}`, { headers });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`GitHub API returned ${response.status} for ${path}: ${detail}`);
  }
  return response.json();
}

async function getOwnedPublicRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({
      type: "owner",
      sort: "updated",
      per_page: String(pageSize),
      page: String(page),
    });
    const pageRepositories = await getGitHubJson(
      `/users/${encodeURIComponent(username)}/repos?${query}`,
    );
    if (!Array.isArray(pageRepositories)) {
      throw new Error("GitHub returned an unexpected repository list.");
    }

    repositories.push(...pageRepositories);
    if (pageRepositories.length < pageSize) return repositories;
  }
}

function assertCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GitHub returned an invalid ${label}.`);
  }
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

function shorten(value, limit) {
  const characters = Array.from(value);
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join("")}…`
    : value;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en").format(value);
}

function createDashboardSvg(account, repositories) {
  const totalStars = repositories.reduce((sum, repository) => sum + repository.stargazers_count, 0);
  const totalForks = repositories.reduce((sum, repository) => sum + repository.forks_count, 0);
  const topRepositories = [...repositories]
    .sort((left, right) =>
      right.stargazers_count - left.stargazers_count
      || Date.parse(right.updated_at) - Date.parse(left.updated_at)
      || left.name.localeCompare(right.name))
    .slice(0, 5);
  const languages = new Map();
  for (const repository of repositories) {
    if (repository.language) {
      languages.set(repository.language, (languages.get(repository.language) || 0) + 1);
    }
  }
  const topLanguages = [...languages.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4);
  const maxLanguageCount = Math.max(1, ...topLanguages.map(([, count]) => count));
  const generatedAt = new Date().toISOString().slice(0, 10);

  const cards = [
    { label: "PUBLIC REPOSITORIES", value: formatNumber(repositories.length), color: "#77E4D2" },
    { label: "STARS EARNED", value: formatNumber(totalStars), color: "#FFD479" },
    { label: "FORKS", value: formatNumber(totalForks), color: "#A9B8FF" },
    { label: "FOLLOWERS", value: formatNumber(account.followers), color: "#D4A8FF" },
  ].map((card, index) => {
    const x = 36 + index * 237;
    return `
  <g>
    <rect x="${x}" y="91" width="221" height="82" rx="13" fill="#111E31" stroke="#7186A5" stroke-opacity=".22"/>
    <text x="${x + 17}" y="119" fill="#91A2BA" font-size="10" font-weight="700" letter-spacing="1.1">${card.label}</text>
    <text x="${x + 17}" y="153" fill="${card.color}" font-size="27" font-weight="700">${card.value}</text>
  </g>`;
  }).join("");

  const repositoryRows = topRepositories.length
    ? topRepositories.map((repository, index) => {
      const y = 269 + index * 31;
      const name = escapeXml(shorten(repository.name, 28));
      const language = escapeXml(shorten(repository.language || "Other", 12));
      return `
    <text x="56" y="${y}" fill="#E3EAF5" font-size="12" font-weight="600">${name}</text>
    <text x="392" y="${y}" fill="#AAB8CD" font-size="11">${language}</text>
    <text x="484" y="${y}" fill="#FFD479" font-size="11">${formatNumber(repository.stargazers_count)}</text>
    <text x="552" y="${y}" fill="#A9B8FF" font-size="11">${formatNumber(repository.forks_count)}</text>
    <path d="M56 ${y + 10}H612" stroke="#7588A3" stroke-opacity=".13"/>`;
    }).join("")
    : '<text x="56" y="272" fill="#AAB8CD" font-size="12">No public repositories found.</text>';

  const languageRows = topLanguages.length
    ? topLanguages.map(([language, count], index) => {
      const y = 267 + index * 38;
      const barWidth = Math.max(5, Math.round((count / maxLanguageCount) * 299));
      return `
    <text x="641" y="${y}" fill="#E3EAF5" font-size="11">${escapeXml(language)}</text>
    <text x="940" y="${y}" fill="#AAB8CD" font-size="11" text-anchor="end">${count}</text>
    <rect x="641" y="${y + 7}" width="299" height="5" rx="2.5" fill="#26354B"/>
    <rect x="641" y="${y + 7}" width="${barWidth}" height="5" rx="2.5" fill="#77E4D2"/>`;
    }).join("")
    : '<text x="641" y="267" fill="#AAB8CD" font-size="11">Language data not available.</text>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="464" viewBox="0 0 1000 464" fill="none" role="img" aria-labelledby="title description">
  <title id="title">GitHub repository dashboard for @${escapeXml(username)}</title>
  <desc id="description">${repositories.length} verified public repositories, ${totalStars} stars, ${totalForks} forks, and ${account.followers} followers. Updated ${generatedAt}.</desc>
  <defs>
    <linearGradient id="background" x1="20" y1="0" x2="980" y2="464" gradientUnits="userSpaceOnUse">
      <stop stop-color="#101A2D"/>
      <stop offset="1" stop-color="#08111F"/>
    </linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" stroke="#9BB5D9" stroke-opacity=".045"/>
    </pattern>
  </defs>
  <rect width="1000" height="464" rx="22" fill="url(#background)"/>
  <rect width="1000" height="464" rx="22" fill="url(#grid)"/>
  <text x="38" y="43" fill="#77E4D2" font-size="11" font-weight="700" letter-spacing="2">GITHUB  /  REPOSITORY DASHBOARD</text>
  <text x="38" y="68" fill="#C5D1E2" font-size="13">@${escapeXml(username)} · Public work, checked against GitHub</text>
  <text x="961" y="43" fill="#91A2BA" font-size="11" text-anchor="end">UPDATED ${generatedAt} UTC</text>
  ${cards}
  <rect x="36" y="190" width="590" height="228" rx="13" fill="#111E31" stroke="#7186A5" stroke-opacity=".22"/>
  <rect x="642" y="190" width="322" height="228" rx="13" fill="#111E31" stroke="#7186A5" stroke-opacity=".22"/>
  <text x="56" y="219" fill="#F1F5F9" font-size="12" font-weight="700" letter-spacing="1">MOST-STARRED REPOSITORIES</text>
  <text x="392" y="247" fill="#8192AA" font-size="9" font-weight="700">LANGUAGE</text>
  <text x="484" y="247" fill="#8192AA" font-size="9" font-weight="700">STARS</text>
  <text x="552" y="247" fill="#8192AA" font-size="9" font-weight="700">FORKS</text>
  ${repositoryRows}
  <text x="662" y="219" fill="#F1F5F9" font-size="12" font-weight="700" letter-spacing=".7">LANGUAGES · REPO COUNT</text>
  ${languageRows}
  <path d="M36 434H964" stroke="#7186A5" stroke-opacity=".24"/>
  <text x="38" y="451" fill="#91A2BA" font-size="10">VERIFIED ${repositories.length} / ${account.public_repos} PUBLIC REPOSITORIES · OWNERSHIP CHECKED VIA GITHUB API</text>
</svg>`;
}

async function main() {
  const account = await getGitHubJson(`/users/${encodeURIComponent(username)}`);
  if (account.login?.toLowerCase() !== username.toLowerCase()) {
    throw new Error(`GitHub returned account "${account.login}" instead of "${username}".`);
  }
  assertCount(account.public_repos, "public repository count");
  assertCount(account.followers, "follower count");

  const repositories = await getOwnedPublicRepositories();
  const repositoryNames = new Set();
  for (const repository of repositories) {
    if (repository.full_name && repositoryNames.has(repository.full_name)) {
      throw new Error(`GitHub returned duplicate repository "${repository.full_name}".`);
    }
    repositoryNames.add(repository.full_name);
  }
  const invalidRepositories = repositories.filter((repository) =>
    repository.private !== false
    || repository.owner?.login?.toLowerCase() !== account.login.toLowerCase()
    || typeof repository.name !== "string"
    || typeof repository.full_name !== "string"
    || !Number.isSafeInteger(repository.stargazers_count)
    || repository.stargazers_count < 0
    || !Number.isSafeInteger(repository.forks_count)
    || repository.forks_count < 0
    || !Number.isFinite(Date.parse(repository.updated_at)));
  if (invalidRepositories.length > 0) {
    const names = invalidRepositories.map((repository) => repository.full_name || "unknown").join(", ");
    throw new Error(`Repository ownership or public metadata could not be verified: ${names}`);
  }
  if (repositories.length !== account.public_repos) {
    throw new Error(
      `GitHub reports ${account.public_repos} public repositories, but returned ${repositories.length}; refusing to publish incomplete stats.`,
    );
  }

  const dashboardUrl = new URL("../public/images/repository-dashboard.svg", import.meta.url);
  await writeFile(dashboardUrl, `${createDashboardSvg(account, repositories)}\n`, "utf8");
  console.log(
    `Verified ${repositories.length} public repositories for @${account.login}; dashboard updated.`,
  );
}

main().catch((error) => {
  console.error(`Repository dashboard update failed: ${error.message}`);
  process.exitCode = 1;
});
