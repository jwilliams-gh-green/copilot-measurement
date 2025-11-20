## A visualizer for GitHub Copilot Metrics
### Steps to run this application:
1. `git clone https://github.com/jwilliams-gh-green/copilot-measurement.git`
2. `docker compose up --build`
3. Navigate to `http://localhost:3000` in a browser tab
4. Enter your GitHub organization name and an auth token (CLI, PAT, etc.) or explicitly post the data. Example using bash + [GH CLI](https://cli.github.com/) + [jq](https://jqlang.org/):
```shell
ORG=<org name>
TOKEN=$(gh auth token)

curl --request POST \
--url "http://localhost:3000/api/config" \
--header "content-type: application/json" \
--data '{"token":"'$TOKEN'","org":"'$ORG'"}' \
| jq
```
5. If you opt not to use the UI to enter configuratation data, given that this is a SPA, you can simply reload/refresh `https://localhost:3000` after the data is posted to view the **Metrics Dashboard** with the relevant data populated.