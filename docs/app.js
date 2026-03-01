const dataUrl = "robots.json";
const issueUrl =
  "https://github.com/urdf-studio/urdf-robot-gallery/issues/new?template=robot-repo-submission.yml";
const updateIssueUrl =
  "https://github.com/urdf-studio/urdf-robot-gallery/issues/new?template=robot-entry-update.yml";

const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty");
const countEl = document.getElementById("robot-count");
const searchInput = document.getElementById("search-input");

const state = {
  robots: [],
  query: "",
};

const normalize = (value) => (value || "").toString().toLowerCase();
const normalizeLicense = (value) => {
  const raw = (value || "").toString().trim();
  if (!raw || raw.toUpperCase() === "NOASSERTION") return "";
  return raw;
};

const normalizeRobotPath = (value) =>
  (value || "")
    .toString()
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

const toRobotEntry = (entry) => {
  if (typeof entry === "string") {
    const file = normalizeRobotPath(entry);
    return {
      name: file.replace(/\.(urdf(\.xacro)?|xacro)$/i, ""),
      file,
      fileBase: "",
    };
  }
  const file = normalizeRobotPath(entry?.file || entry?.name || "");
  return {
    name: (entry?.name || file.replace(/\.(urdf(\.xacro)?|xacro)$/i, "") || "robot").toString(),
    file,
    fileBase: (entry?.fileBase || "").toString(),
  };
};

const createRobotIssuePayload = (repoTags, robotEntry) => {
  const tags = Array.isArray(repoTags) ? repoTags.filter(Boolean) : [];
  const tagsValue = tags.length > 0 ? tags.join(", ") : "none";
  return (
    `${robotEntry.name} - ${robotEntry.file}` +
    (robotEntry.fileBase ? ` - fileBase: ${robotEntry.fileBase}` : "") +
    ` - tags: ${tagsValue}`
  );
};

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "absolute";
  textarea.style.left = "-10000px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const matchesQuery = (robot, query) => {
  if (!query) return true;
  const robotEntries = (robot.robots || []).map(toRobotEntry);
  const haystack = [
    robot.name,
    robot.org,
    robot.summary,
    robot.repo,
    robot.demo,
    robot.license,
    ...robotEntries.map((entry) => entry.file),
    ...robotEntries.map((entry) => entry.fileBase),
    ...(robot.tags || []),
  ]
    .map(normalize)
    .join(" ");
  return haystack.includes(query);
};

const renderCard = (robot) => {
  const card = document.createElement("div");
  card.className = "card";

  const heading = document.createElement("div");
  const name = document.createElement("h3");
  const fallbackName = robot.repo ? robot.repo.split("/").slice(-2).join("/") : "Robot Repo";
  name.textContent = robot.name || fallbackName;
  heading.appendChild(name);
  if (robot.org) {
    const org = document.createElement("div");
    org.className = "org";
    org.textContent = robot.org;
    heading.appendChild(org);
  }

  const summary = document.createElement("p");
  summary.textContent = robot.summary;

  const licenseLine = document.createElement("p");
  licenseLine.className = "license";
  const normalizedLicense = normalizeLicense(robot.license);
  licenseLine.textContent = `License: ${normalizedLicense || "Unknown"}`;

  let robotsList = null;
  if (Array.isArray(robot.robots) && robot.robots.length > 0) {
    const robotEntries = robot.robots.map(toRobotEntry).filter((entry) => entry.file);
    if (robotEntries.length > 0) {
      robotsList = document.createElement("div");
      robotsList.className = "robot-list";

      const listLabel = document.createElement("p");
      listLabel.className = "robots";
      listLabel.textContent = "URDF files";
      robotsList.appendChild(listLabel);

      robotEntries.forEach((robotEntry) => {
        const row = document.createElement("div");
        row.className = "robot-item";

        const info = document.createElement("div");
        info.className = "robot-info";

        const robotTitle = document.createElement("span");
        robotTitle.className = "robot-name";
        robotTitle.textContent = robotEntry.name;
        info.appendChild(robotTitle);

        const robotFile = document.createElement("code");
        robotFile.className = "robot-file";
        robotFile.textContent = robotEntry.file;
        info.appendChild(robotFile);

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "copy-btn";
        copyButton.textContent = "Copy";
        copyButton.title =
          "Copy a ready-to-paste line for Robot Entry Update issue (targeted regenerate/tags)";
        copyButton.addEventListener("click", async () => {
          const payload = createRobotIssuePayload(robot.tags || [], robotEntry);
          try {
            await copyText(payload);
            copyButton.classList.add("copied");
            copyButton.textContent = "Copied";
            window.setTimeout(() => {
              copyButton.classList.remove("copied");
              copyButton.textContent = "Copy";
            }, 1300);
          } catch {
            copyButton.textContent = "Error";
            window.setTimeout(() => {
              copyButton.textContent = "Copy";
            }, 1300);
          }
        });

        row.appendChild(info);
        row.appendChild(copyButton);
        robotsList.appendChild(row);
      });
    }
  }

  const tags = document.createElement("div");
  tags.className = "tags";
  (robot.tags || []).forEach((tag) => {
    const badge = document.createElement("span");
    badge.className = "tag";
    badge.textContent = tag;
    tags.appendChild(badge);
  });

  const links = document.createElement("div");
  links.className = "links";

  const repoLink = document.createElement("a");
  repoLink.href = robot.repo;
  repoLink.target = "_blank";
  repoLink.rel = "noopener noreferrer";
  repoLink.textContent = "GitHub →";
  links.appendChild(repoLink);

  if (robot.demo) {
    const demoLink = document.createElement("a");
    demoLink.href = robot.demo;
    demoLink.target = "_blank";
    demoLink.rel = "noopener noreferrer";
    demoLink.className = "secondary";
    demoLink.textContent = "Demo →";
    links.appendChild(demoLink);
  }

  const updateLink = document.createElement("a");
  const repoValue = (robot.repo || "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  const updatePrefill = repoValue
    ? `${updateIssueUrl}&github_repo=${encodeURIComponent(repoValue)}`
    : updateIssueUrl;
  updateLink.href = updatePrefill;
  updateLink.target = "_blank";
  updateLink.rel = "noopener noreferrer";
  updateLink.className = "secondary";
  updateLink.textContent = "Update/regenerate →";
  links.appendChild(updateLink);

  card.appendChild(heading);
  card.appendChild(summary);
  card.appendChild(licenseLine);
  if (robotsList) {
    card.appendChild(robotsList);
  }
  if (robot.tags && robot.tags.length) {
    card.appendChild(tags);
  }
  card.appendChild(links);

  return card;
};

const render = () => {
  const query = normalize(state.query);
  const filtered = state.robots.filter((robot) => matchesQuery(robot, query));

  grid.innerHTML = "";
  filtered.forEach((robot) => grid.appendChild(renderCard(robot)));

  countEl.textContent = state.robots.length.toString();
  emptyState.classList.toggle("hidden", filtered.length > 0);

  if (state.robots.length === 0) {
    emptyState.querySelector("a").href = issueUrl;
  }
};

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

fetch(dataUrl)
  .then((response) => response.json())
  .then((robots) => {
    if (!Array.isArray(robots)) {
      throw new Error("robots.json must be an array");
    }
    state.robots = robots;
    render();
  })
  .catch(() => {
    state.robots = [];
    render();
  });
