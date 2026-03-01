const DEFAULT_ACCEPT = "application/vnd.github.v3+json";

export const buildGitHubHeaders = ({
  token = "",
  userAgent = "urdf-star-studio",
  accept = DEFAULT_ACCEPT,
} = {}) => {
  const headers = {
    Accept: accept,
    "User-Agent": userAgent,
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }
  return headers;
};

export const fetchJsonWithHeaders = async (url, headers) => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `HTTP ${response.status} for ${url}${body ? ` - ${body.slice(0, 300)}` : ""}`
    );
    error.status = response.status;
    error.headers = Object.fromEntries(response.headers.entries());
    error.body = body;
    throw error;
  }
  return response.json();
};

export const fetchTextWithHeaders = async (url, headers) => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `HTTP ${response.status} for ${url}${body ? ` - ${body.slice(0, 300)}` : ""}`
    );
    error.status = response.status;
    error.headers = Object.fromEntries(response.headers.entries());
    error.body = body;
    throw error;
  }
  return response.text();
};

export const fetchGitHubApiJson = async (
  endpointOrUrl,
  { token = "", userAgent = "urdf-star-studio", accept = DEFAULT_ACCEPT } = {}
) => {
  const url = endpointOrUrl.startsWith("http")
    ? endpointOrUrl
    : `https://api.github.com${endpointOrUrl}`;
  const headers = buildGitHubHeaders({ token, userAgent, accept });
  return fetchJsonWithHeaders(url, headers);
};
