import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { Loader2 } from 'lucide-react';

// ============================================================================
// DATA TRANSFORMATION UTILITIES
// ============================================================================
// These functions transform the raw GitHub API response into chart-friendly data
// Timeline: After API response received → Transform data → Render charts

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088FE'];

// ----------------------------------------------------------------------------
// STEP 4a: Transform Language Data for Pie Chart
// ----------------------------------------------------------------------------
// Input: Array of daily metrics from GitHub API
// Output: Array of {name: "python", value: 150} for pie chart
const transformLanguageData = (metrics) => {
  if (!Array.isArray(metrics)) return [];

  const languageMap = new Map();

  // Iterate through each day's metrics
  metrics.forEach(day => {
    const completions = day.copilot_ide_code_completions;
    if (completions && completions.editors) {
      // Navigate through nested structure: editors → models → languages
      completions.editors.forEach(editor => {
        if (editor.models) {
          editor.models.forEach(model => {
            if (model.languages) {
              model.languages.forEach(lang => {
                // Aggregate lines accepted per language across all days
                const current = languageMap.get(lang.name) || { lines_accepted: 0 };
                languageMap.set(lang.name, {
                  lines_accepted: current.lines_accepted + (lang.total_code_lines_accepted || 0),
                });
              });
            }
          });
        }
      });
    }
  });

  // Convert Map to array, filter out languages with 0 accepted lines, and sort by value
  return Array.from(languageMap, ([language, data]) => ({
    name: language,
    value: data.lines_accepted,
  })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);
};

// ----------------------------------------------------------------------------
// STEP 4b: Transform Daily Metrics for Bar Chart
// ----------------------------------------------------------------------------
// Input: Array of daily metrics from GitHub API
// Output: Array of {day: "2025-11-18", total_lines_suggested: 221, ...} for bar chart
const transformDailyMetrics = (metrics) => {
  if (!Array.isArray(metrics)) return [];

  return metrics.map(day => {
    let totalSuggested = 0;
    let totalAccepted = 0;

    const completions = day.copilot_ide_code_completions;
    if (completions && completions.editors) {
      // Sum up all suggestions and acceptances across all editors/models/languages
      completions.editors.forEach(editor => {
        if (editor.models) {
          editor.models.forEach(model => {
            if (model.languages) {
              model.languages.forEach(lang => {
                totalSuggested += (lang.total_code_lines_suggested || 0);
                totalAccepted += (lang.total_code_lines_accepted || 0);
              });
            }
          });
        }
      });
    }

    // Return simplified daily metrics object
    return {
      day: day.date,
      total_lines_suggested: totalSuggested,
      total_lines_accepted: totalAccepted,
      active_users: day.total_active_users || 0,
      acceptance_rate: totalSuggested > 0 ? (totalAccepted / totalSuggested) * 100 : 0
    };
  }).sort((a, b) => new Date(a.day) - new Date(b.day));  // Sort chronologically
};

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================
// Timeline: Page loads → Check config → Show form OR dashboard
const App = () => {
  // ----------------------------------------------------------------------------
  // STEP 1: Initialize React State
  // ----------------------------------------------------------------------------
  const [token, setToken] = useState('');              // GitHub PAT (from form input)
  const [orgName, setOrgName] = useState('');          // Organization name (from form input)
  const [isConfigured, setIsConfigured] = useState(false);  // Is token/org configured?
  const [data, setData] = useState(null);              // Raw GitHub API response data
  const [loading, setLoading] = useState(false);       // Loading state for UI feedback
  const [error, setError] = useState(null);            // Error message if API calls fail

  // ----------------------------------------------------------------------------
  // STEP 2: Check Configuration on Page Load
  // ----------------------------------------------------------------------------
  // This runs once when the component mounts
  // Timeline: Component mounts → GET /api/config → Update state
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const response = await fetch('/api/config');
        const config = await response.json();
        setIsConfigured(config.hasToken);
        if (config.orgName) {
          setOrgName(config.orgName);
        }
      } catch (e) {
        console.error("Could not reach API config endpoint:", e);
      }
    };
    checkConfig();
  }, []);

  // ----------------------------------------------------------------------------
  // STEP 4c: Transform Data for Visualization (Memoized)
  // ----------------------------------------------------------------------------
  // These transformations run whenever the raw data changes
  // Memoization prevents unnecessary recalculations on re-renders
  const dailyData = useMemo(() => transformDailyMetrics(data), [data]);
  const languageData = useMemo(() => transformLanguageData(data), [data]);
  const overallAcceptanceRate = useMemo(() => {
    if (!Array.isArray(data)) return null;
    const totalAccepted = dailyData.reduce((sum, item) => sum + item.total_lines_accepted, 0);
    const totalSuggested = dailyData.reduce((sum, item) => sum + item.total_lines_suggested, 0);
    return totalSuggested > 0 ? (totalAccepted / totalSuggested) * 100 : 0;
  }, [dailyData, data]);


  // ----------------------------------------------------------------------------
  // STEP 3: Handle Configuration Form Submission
  // ----------------------------------------------------------------------------
  // Timeline: User submits form → POST /api/config → Auto-fetch data
  const handleConfigSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // STEP 3a: Send token and org to backend for storage
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, org: orgName }),
      });

      const result = await response.json();
      if (result.success) {
        setIsConfigured(true);
        // STEP 3b: Automatically fetch metrics data after successful configuration
        await fetchData();
      } else {
        setError(result.message);
        setIsConfigured(false);
      }
    } catch (e) {
      setError('Could not connect to the backend service.');
      setIsConfigured(false);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------------------------------------------
  // STEP 4: Fetch Copilot Metrics from Backend
  // ----------------------------------------------------------------------------
  // Timeline: User clicks "Load Metrics" → GET /api/copilot-metrics → Transform & display
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      // STEP 4a: Request metrics from backend proxy
      const response = await fetch('/api/copilot-metrics');
      const result = await response.json();

      if (response.ok) {
        // STEP 4b: Store raw data in state (triggers transformation via useMemo)
        setData(result);
      } else {
        // Handle API errors (e.g., 403 Forbidden, 404 Not Found)
        setError(result.error || 'An unexpected error occurred during data fetch.');
        console.error('API Error Details:', result.details);
      }
    } catch (e) {
      setError('Error communicating with the backend proxy.');
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------------------------------------------
  // STEP 5: Render Appropriate View Based on State
  // ----------------------------------------------------------------------------
  // This function determines what to show: loading, error, config form, or dashboard
  const renderActiveView = () => {
    // STEP 5a: Show loading spinner while fetching data
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-64">
          <div className="animate-spin text-indigo-500">
            <Loader2 size={48} />
          </div>
          <p className="mt-4 text-gray-500">Fetching Copilot metrics...</p>
        </div>
      );
    }

    // STEP 5b: Show error message if API call failed
    if (error) {
      return (
        <div className="p-6 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-lg shadow-lg">
          <p className="font-bold">Data Fetch Error</p>
          <p>{error}</p>
          <button
            onClick={() => setIsConfigured(false)}
            className="mt-4 px-4 py-2 bg-red-500 text-white font-semibold rounded-lg shadow hover:bg-red-600 transition"
          >
            Reconfigure Token
          </button>
        </div>
      );
    }

    // STEP 5c: Show configuration form if not yet configured
    if (!isConfigured) {
      return (
        <ConfigurationForm
          token={token}
          setToken={setToken}
          orgName={orgName}
          setOrgName={setOrgName}
          onSubmit={handleConfigSubmit}
          isLoading={loading}
        />
      );
    }

    // STEP 5d: Show dashboard with visualizations if data is available
    if (data) {
      return (
        <Dashboard
          dailyData={dailyData}
          languageData={languageData}
          overallAcceptanceRate={overallAcceptanceRate}
          onRefresh={fetchData}
        />
      );
    }

    // STEP 5e: Show "Load Metrics" button if configured but no data yet
    return (
      <div className="p-6 text-center text-gray-500">
        <p>Configuration successful for organization **{orgName}**.</p>
        <button
          onClick={fetchData}
          className="mt-4 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition transform hover:scale-[1.02]"
        >
          Load Copilot Metrics
        </button>
      </div>
    );
  };

  // ----------------------------------------------------------------------------
  // STEP 6: Main Component Render
  // ----------------------------------------------------------------------------
  // Renders the application layout with header and dynamic content area
  return (
    <div className="min-h-screen bg-gray-50 font-sans p-4 sm:p-8">
      <header className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight sm:text-5xl">
          GitHub Copilot Metrics Visualizer
        </h1>
        <p className="mt-2 text-lg text-gray-500">
          {orgName ? `Organization: ${orgName}` : 'Unknown organization'}
        </p>
      </header>

      <main className="max-w-7xl mx-auto">
        <div className="bg-white p-6 sm:p-10 rounded-xl shadow-2xl border border-gray-100">
          {/* Dynamically render: loading, error, form, or dashboard */}
          {renderActiveView()}
        </div>
      </main>
    </div>
  );
};

// ============================================================================
// CHILD COMPONENTS
// ============================================================================

// ----------------------------------------------------------------------------
// ConfigurationForm Component
// ----------------------------------------------------------------------------
// Renders the form for entering GitHub token and organization name
const ConfigurationForm = ({ token, setToken, orgName, setOrgName, onSubmit, isLoading }) => (
  <form onSubmit={onSubmit} className="space-y-6">
    <h2 className="text-2xl font-semibold text-gray-800 mb-4">API Configuration</h2>
    <p className="text-sm text-gray-600">
      Enter your GitHub Enterprise Organization name and a Personal Access Token (PAT) with the necessary `read: org` or `read: enterprise` scope to access Copilot metrics.
    </p>

    <div>
      <label htmlFor="orgName" className="block text-sm font-medium text-gray-700">
        Organization Name
      </label>
      <input
        type="text"
        id="orgName"
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        required
        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
        placeholder="e.g., my-enterprise-org"
      />
    </div>

    <div>
      <label htmlFor="token" className="block text-sm font-medium text-gray-700">
        GitHub PAT (Bearer Token)
      </label>
      <input
        type="password"
        id="token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
        placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxx"
      />
    </div>

    <button
      type="submit"
      disabled={isLoading}
      className={`w - full flex justify - center py - 3 px - 4 border border - transparent rounded - lg shadow - lg text - sm font - medium text - white transition transform ${isLoading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.01]'
        } `}
    >
      {isLoading ? 'Saving Configuration...' : 'Save Configuration & Load Data'}
    </button>
  </form>
);

// ----------------------------------------------------------------------------
// Dashboard Component
// ----------------------------------------------------------------------------
// Displays the metrics visualizations: summary cards, bar chart, and pie chart
const Dashboard = ({ dailyData, languageData, overallAcceptanceRate, onRefresh }) => (
  <div className="space-y-12">
    <div className="flex justify-between items-center pb-4 border-b border-gray-200">
      <h2 className="text-3xl font-bold text-gray-800">Metrics Dashboard</h2>
      <button
        onClick={onRefresh}
        className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg shadow hover:bg-gray-300 transition"
      >
        Refresh Data
      </button>
    </div>

    {/* Key Metrics Summary */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
      <MetricCard
        title="Overall Acceptance Rate"
        value={overallAcceptanceRate !== null ? `${overallAcceptanceRate.toFixed(1)}% ` : 'N/A'}
        description="Ratio of accepted lines to suggested lines."
      />
      <MetricCard
        title="Total Lines Suggested (Sample)"
        value={(dailyData.reduce((sum, d) => sum + d.total_lines_suggested, 0) / 1000).toFixed(1) + 'K'}
        description="Total code lines suggested by Copilot."
      />
      <MetricCard
        title="Total Active Users (Daily Max)"
        value={Math.max(...dailyData.map(d => d.active_users))}
        description="Peak daily active users in the sampled period."
      />
    </div>

    {/* Lines Suggested vs Accepted Bar Chart */}
    <ChartCard title="Daily Code Volume: Suggested vs. Accepted Lines">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={dailyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="day" stroke="#555" />
          <YAxis stroke="#555" />
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            formatter={(value, name) => [value.toLocaleString(), name]}
          />
          <Legend />
          <Bar dataKey="total_lines_suggested" name="Lines Suggested" fill="#8884d8" radius={[10, 10, 0, 0]} />
          <Bar dataKey="total_lines_accepted" name="Lines Accepted" fill="#82ca9d" radius={[10, 10, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>

    {/* Language Breakdown Pie Chart */}
    <ChartCard title="Accepted Lines Breakdown by Language">
      <div className="flex justify-center items-center h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={languageData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={120}
              fill="#8884d8"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}% `}
            >
              {languageData.map((entry, index) => (
                <Cell key={`cell - ${index} `} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              formatter={(value, name, props) => [`${value.toLocaleString()} Lines`, name]}
            />
            <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ paddingLeft: '20px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  </div>
);

// ----------------------------------------------------------------------------
// Helper Components
// ----------------------------------------------------------------------------

// MetricCard: Displays a single metric summary (acceptance rate, total lines, etc.)
const MetricCard = ({ title, value, description }) => (
  <div className="p-6 bg-indigo-50 rounded-xl shadow-lg border-t-4 border-indigo-500">
    <p className="text-sm font-medium text-indigo-700 uppercase tracking-wider">{title}</p>
    <p className="mt-1 text-4xl font-extrabold text-gray-900">{value}</p>
    <p className="mt-2 text-xs text-gray-500">{description}</p>
  </div>
);

// ChartCard: Container component for Recharts visualizations
const ChartCard = ({ title, children }) => (
  <div className="bg-white p-6 rounded-xl shadow-xl border border-gray-100">
    <h3 className="text-xl font-semibold text-gray-800 mb-6 border-b pb-2">{title}</h3>
    {children}
  </div>
);

export default App;