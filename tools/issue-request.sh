USERNAME=dpclark4
TOKEN=$GH_TOKEN
OWNER=$1
REPO=$2
ISSUE_NUMBER=$3

echo "Issue number: $ISSUE_NUMBER"

BASE_URL="https://api.github.com"

ENCODED=$(printf "%s:%s" "$USERNAME" "$TOKEN" | base64)

curl -H "Accept: application/vnd.github+json" \
     -H "Authorization: Basic $ENCODED" \
     -w "%{http_code}\n" \
     "$BASE_URL/repos/$OWNER/$REPO/issues/$ISSUE_NUMBER"