#!/bin/bash

TOKEN="$GH_TOKEN"     
OWNER=$1
REPO=$2
DISCUSSION_NUMBER=$3

echo "Token: $TOKEN"
echo "Owner: $OWNER"
echo "Repo: $REPO"
echo "Discussion number: $DISCUSSION_NUMBER"

read -r -d '' QUERY <<EOF
query (\$owner: String!, \$repo: String!, \$discussionNumber: Int!) {
  repository(owner: \$owner, name: \$repo) {
    discussion(number: \$discussionNumber) {
      id
      number
      title
      body
      url
      createdAt
      updatedAt
      author {
        login
      }
    }
  }
}
EOF

JSON_PAYLOAD=$(jq -n \
  --arg query "$QUERY" \
  --arg owner "$OWNER" \
  --arg repo "$REPO" \
  --argjson discussionNumber "$DISCUSSION_NUMBER" \
  '{ query: $query, variables: { owner: $owner, repo: $repo, discussionNumber: $discussionNumber } }')

# JSON Payload
JSON_PAYLOAD=$(jq -n \
  --arg query "$QUERY" \
  --arg owner "$OWNER" \
  --arg repo "$REPO" \
  --argjson discussionNumber "$DISCUSSION_NUMBER" \
  '{ query: $query, variables: { owner: $owner, repo: $repo, discussionNumber: $discussionNumber } }')

# Make the API request
response=$(curl -s -H "Authorization: bearer $TOKEN" \
               -H "Content-Type: application/json" \
               -X POST \
               -d "$JSON_PAYLOAD" \
               https://api.github.com/graphql)

# Check for errors
errors=$(echo "$response" | jq '.errors')

if [ "$errors" != "null" ]; then
  echo "Error fetching discussion:"
  echo "$errors" | jq
  exit 1
fi

# Extract and display discussion details
discussion=$(echo "$response" | jq '.data.repository.discussion')

if [ "$discussion" == "null" ]; then
  echo "Discussion #$DISCUSSION_NUMBER does not exist in $OWNER/$REPO."
else
  echo "Discussion #$DISCUSSION_NUMBER exists:"
  echo "$discussion" | jq
fi
