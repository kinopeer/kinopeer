/** Kinopeer's pages on GitHub, linked from Settings → About. */
export const REPO_URL = 'https://github.com/kinopeer/kinopeer'
export const IDEAS_URL = `${REPO_URL}/discussions/categories/ideas`
/** The bug report form (`.github/ISSUE_TEMPLATE/bug_report.yml`), with its `version` field filled in. */
export const BUG_REPORT_URL = `${REPO_URL}/issues/new?${new URLSearchParams({ template: 'bug_report.yml', version: __APP_VERSION__ })}`
