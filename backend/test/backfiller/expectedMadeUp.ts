export const expectedIssues = [
  {
    _id: 3,
    id: 1,
    title: "Sample Issue Title 1",
    state: "closed",
    body: "This is the description of the issue.",
    created_at: "2023-09-15T10:30:00.000Z",
    updated_at: "2023-09-16T15:45:00.000Z",
    closed_at: "2023-09-17T15:45:00.000Z",
    user: { name: "userA" },
    _pr_id: 2,
    merged_at: "2023-09-17T15:45:00.000Z",
    target_branch: "master",
    source_branch: "main",
    rounds_of_review: 0,
    reviewComments: [],
    issueComments: [
      {
        body: "This looks good!",
        created_at: "2023-09-15T12:30:00.000Z",
        updated_at: "2023-09-15T12:30:00.000Z",
        author_association: "MEMBER",
        user: { name: "userA" },
      },
      {
        body: "I have some concerns about this change.",
        created_at: "2023-09-15T11:30:00.000Z",
        updated_at: "2023-09-15T11:30:00.000Z",
        author_association: "CONTRIBUTOR",
        user: { name: "userB" },
      },
    ],
    commits: [
      {
        message: "Fixes a bug in the code.",
        committed_at: "2023-09-15T10:00:00.000Z",
        user: { name: "userA" },
      },
      {
        message: "Adds a new feature to the code.",
        committed_at: "2023-09-15T11:00:00.000Z",
        user: { name: "userA" },
      },
      {
        committed_at: "2023-09-15T10:58:00.000Z",
        message: "Commit with empty author for testing purposes.",
        user: {
          name: "userA",
        },
      },
      {
        committed_at: "2023-09-15T10:59:00.000Z",
        message: "Commit with null author for testing purposes.",
        user: {
          name: "userA",
        },
      },
    ],
    files: [
      {
        filename: "version/version.go",
        additions: 75,
        deletions: 50,
        changes: 125,
      },
      {
        filename: "version/xversion.go",
        additions: 25,
        deletions: 0,
        changes: 25,
      },
    ],
  },
  {
    _id: 2,
    body: "This is the description of issue 2.",
    closed_at: null,
    created_at: "2023-09-18T08:30:00.000Z",
    id: 2,
    state: "open",
    title: "Sample Issue Title 2",
    updated_at: "2023-09-19T09:45:00.000Z",
    user: {
      name: "userB",
    },
  },
  {
    _id: 1,
    _pr_id: 1,
    body: "",
    closed_at: "2022-06-21T21:30:48.000Z",
    commits: [],
    created_at: "2022-06-16T20:28:58.000Z",
    files: [],
    id: 3,
    issueComments: [
      {
        author_association: "MEMBER",
        body: "issue comment",
        created_at: "2020-06-24T18:25:21.000Z",
        updated_at: "2020-06-24T18:25:21.000Z",
        user: {
          name: "ghost",
        },
      },
    ],
    merged_at: "2022-06-21T21:30:48.000Z",
    reviewComments: [
      {
        author_association: "NONE",
        body: "review comment",
        created_at: "2022-06-21T14:55:52.000Z",
        updated_at: "2022-06-21T19:16:23.000Z",
        user: {
          name: "ghost",
        },
      },
    ],
    rounds_of_review: 0,
    source_branch: "new_branch",
    state: "closed",
    target_branch: "master",
    title: "Test title",
    updated_at: "2022-06-21T21:30:49.000Z",
    user: {
      name: "ghost",
    },
  },
];
