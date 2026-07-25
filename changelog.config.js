module.exports = {
  header: `# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

> This project is a fork of [MMM-RAIN-MAP](https://github.com/jalibu/MMM-RAIN-MAP) by jalibu. For the changelog prior to the fork, see the [original project's CHANGELOG.md](https://github.com/jalibu/MMM-RAIN-MAP/blob/main/CHANGELOG.md).
`,
  types: [
    { type: 'feat', section: 'Added', hidden: false },
    { type: 'fix', section: 'Fixed', hidden: false },
    { type: 'perf', section: 'Performance Improvements', hidden: false },
    { type: 'docs', section: 'Documentation', hidden: false },
    { type: 'chore', section: 'Chores', hidden: false },
    { type: 'refactor', section: 'Code Refactoring', hidden: false },
    { type: 'test', section: 'Tests', hidden: false },
    { type: 'build', section: 'Build System', hidden: false },
    { type: 'ci', section: 'Continuous Integration', hidden: false }
  ],
  scripts: {
    postbump: 'node --run build && git add MMM-RainfallMapDWD.js'
  }
}
