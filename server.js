// ============================================================================
// STEP 1: Initialize Express Server and Dependencies
// ============================================================================
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_API_BASE_URL = 'https://api.github.com';

// In-memory storage for GitHub credentials (lost on server restart)
let GITHUB_TOKEN = '';
let ORG_NAME = '';

// Middleware to parse JSON request bodies
app.use(express.json());

// ============================================================================
// STEP 2: Configuration Endpoint - Store GitHub Token and Organization
// ============================================================================
// This endpoint is called when the user submits the configuration form
// Timeline: User fills form → Frontend POST /api/config → This handler
app.post('/api/config', (req, res) => {
    const { token, org } = req.body;

    // Validate that both token and org are provided
    if (!token || !org) {
        return res.status(400).json({ success: false, message: 'Token and Organization are required.' });
    }

    // Store credentials in memory for subsequent API calls
    GITHUB_TOKEN = token.trim();
    ORG_NAME = org.trim();
    console.log(`Token and Org set successfully. Org: ${ORG_NAME}`);

    // Respond to frontend that configuration was successful
    res.json({ success: true, message: 'Configuration saved. You can now fetch data.' });
});

// ============================================================================
// STEP 2a: Check Configuration Status
// ============================================================================
// This endpoint allows the frontend to check if credentials are already configured
// Timeline: Page load → Frontend GET /api/config → This handler
app.get('/api/config', (req, res) => {
    res.json({
        hasToken: !!GITHUB_TOKEN,  // Boolean: is token configured?
        orgName: ORG_NAME           // Return org name if set
    });
});

// ============================================================================
// STEP 3: Metrics Proxy Endpoint - Fetch Data from GitHub API
// ============================================================================
// This is the core proxy endpoint that securely fetches Copilot metrics
// Timeline: User clicks "Load Metrics" → Frontend GET /api/copilot-metrics → This handler
app.get('/api/copilot-metrics', async (req, res) => {
    // STEP 3a: Verify credentials are configured
    if (!GITHUB_TOKEN || !ORG_NAME) {
        return res.status(401).json({ error: 'GitHub Token or Organization Name not set. Please configure the app first.' });
    }

    // STEP 3b: Construct GitHub API URL for Copilot metrics
    const githubUrl = `${GITHUB_API_BASE_URL}/orgs/${ORG_NAME}/copilot/metrics`;

    // STEP 3c: Set up timeout controller (5 second limit)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        // STEP 3d: Make authenticated request to GitHub API
        // This is where the server acts as a proxy, keeping the token secure
        const response = await fetch(githubUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,      // Authenticate with stored token
                'Accept': 'application/vnd.github.v3+json',     // Request JSON response
                'X-GitHub-Api-Version': '2022-11-28'            // Specify API version
            },
            signal: controller.signal  // Enable timeout cancellation
        });

        clearTimeout(timeoutId);  // Cancel timeout if request completes

        // STEP 3e: Handle GitHub API errors (403 Forbidden, 404 Not Found, etc.)
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`GitHub API Error (${response.status}): ${errorText}`);
            return res.status(response.status).json({
                error: 'Failed to fetch metrics from GitHub API.',
                details: errorText
            });
        }

        // STEP 3f: Parse and log the successful response
        const data = await response.json();
        // console.log('GitHub API Response Data:', JSON.stringify(data, null, 2)); // Debug log

        // STEP 3g: Forward the GitHub API response to the frontend
        res.json(data);

    } catch (error) {
        clearTimeout(timeoutId);

        // STEP 3h: Handle timeout errors
        if (error.name === 'AbortError') {
            console.error('Proxy fetch timeout: GitHub API request took too long (5s limit).');
            return res.status(504).json({ error: 'Gateway Timeout: Request to GitHub API timed out.' });
        }

        // STEP 3i: Handle other network/fetch errors
        console.error('Proxy fetch error:', error);
    }
});

// ============================================================================
// STEP 4: Serve React Frontend Static Files
// ============================================================================
// Serve the built React application from the client/build directory
app.use(express.static(path.join(__dirname, 'client/build')));

// ============================================================================
// STEP 5: Handle Client-Side Routing (SPA Support)
// ============================================================================
// For any non-API routes, serve the React app's index.html
// This enables client-side routing to work properly
app.get('*', (req, res, next) => {
    // Skip API routes and static files (they have file extensions)
    if (req.path.startsWith('/api') || path.extname(req.path).length > 0) {
        return next();
    }

    // Serve the React app for all other routes
    res.sendFile(path.resolve(__dirname, 'client/build', 'index.html'));
});

// ============================================================================
// STEP 6: Start the Express Server
// ============================================================================
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});