"use client";

import { startTransition, useEffect, useState } from "react";

const SNAPSHOT_PATH = "/api/live-snapshot";
const HISTORY_LIMIT = 24;
const HISTORY_PATH = `/api/history?limit=${HISTORY_LIMIT}`;

function formatUnits(value) {
  return `${value} unit${value === 1 ? "" : "s"}`;
}

function formatPrice(value) {
  return value === null ? "N/A" : `$${value.toFixed(2)}/hr`;
}

function formatGeneratedAt(snapshot) {
  if (snapshot.generatedAtLabel) {
    return snapshot.generatedAtLabel;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(snapshot.generatedAt));
}

async function fetchJson(path) {
  const response = await fetch(path, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? payload?.error ?? `Request failed with status ${response.status}`);
  }

  return response.json();
}

async function loadDashboard(forceRefresh = false) {
  const snapshotPath = forceRefresh ? `${SNAPSHOT_PATH}?refresh=1` : SNAPSHOT_PATH;
  const snapshot = await fetchJson(snapshotPath);

  try {
    const history = await fetchJson(HISTORY_PATH);

    return {
      snapshot,
      history,
      warning: ""
    };
  } catch (error) {
    return {
      snapshot,
      history: null,
      warning: error instanceof Error ? error.message : String(error)
    };
  }
}

function MetricCard({ label, value, tone = "neutral" }) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function ChipCard({ chip }) {
  return (
    <article className="chip-card" style={{ "--chip-accent": chip.color, "--chip-soft": chip.accentColor }}>
      <div className="chip-card-header">
        <p className="chip-name">{chip.label}</p>
        <span className="chip-price">{formatPrice(chip.cheapestObservedPrice)}</span>
      </div>
      <dl className="chip-metrics">
        <div>
          <dt>Observable Units</dt>
          <dd>{formatUnits(chip.totalAvailableUnits)}</dd>
        </div>
        <div>
          <dt>Provider Signals</dt>
          <dd>{chip.providers.length}</dd>
        </div>
        <div>
          <dt>Offer Rows</dt>
          <dd>{chip.totalOfferCount}</dd>
        </div>
      </dl>
      <p className="chip-summary">{chip.summary}</p>
    </article>
  );
}

function ProviderRow({ provider, maxUnits }) {
  const width = maxUnits === 0 ? 0 : Math.max((provider.availableUnits / maxUnits) * 100, provider.availableUnits > 0 ? 6 : 0);

  return (
    <article className="provider-row">
      <div className="provider-row-header">
        <div>
          <strong>{provider.providerName}</strong>
          <p>{provider.detailLabel}</p>
        </div>
        <span className={`status-pill status-${provider.stockStatus.toLowerCase()}`}>{provider.stockStatus}</span>
      </div>
      <div className="provider-bar-track" aria-hidden="true">
        <span className="provider-bar-fill" style={{ width: `${width}%`, background: provider.providerColor }} />
      </div>
      <dl className="provider-stats">
        <div>
          <dt>Units</dt>
          <dd>{formatUnits(provider.availableUnits)}</dd>
        </div>
        <div>
          <dt>Offers</dt>
          <dd>{provider.offerCount}</dd>
        </div>
        <div>
          <dt>Floor</dt>
          <dd>{formatPrice(provider.cheapestPrice)}</dd>
        </div>
      </dl>
    </article>
  );
}

function Sparkline({ series }) {
  const points = series.points;

  if (points.length === 0) {
    return <p className="history-empty">History will appear after the first persisted snapshots are recorded.</p>;
  }

  if (points.length === 1) {
    return (
      <svg className="history-sparkline" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="0,24 100,24" />
      </svg>
    );
  }

  const maxUnits = Math.max(...points.map((point) => point.totalAvailableUnits), 1);
  const polyline = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 48 - (point.totalAvailableUnits / maxUnits) * 40 - 4;

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="history-sparkline" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={polyline} />
    </svg>
  );
}

function HistoryView({ history }) {
  if (!history) {
    return null;
  }

  return (
    <article className="panel panel-wide">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2>Recent observable unit trend</h2>
        </div>
        <p className="panel-note">{history.count} recorded snapshots</p>
      </div>
      <div className="history-grid">
        {history.series.map((series) => {
          const latestPoint = series.points.at(-1) ?? {
            totalAvailableUnits: 0,
            generatedAtLabel: "No data"
          };
          const earliestPoint = series.points[0] ?? {
            generatedAtLabel: "No data"
          };

          return (
            <article key={series.chip} className="history-card">
              <div className="history-card-header">
                <div>
                  <h3>{series.label}</h3>
                  <p>{latestPoint.generatedAtLabel}</p>
                </div>
                <strong>{formatUnits(latestPoint.totalAvailableUnits)}</strong>
              </div>
              <Sparkline series={series} />
              <div className="history-card-footer">
                <span>{earliestPoint.generatedAtLabel}</span>
                <span>{latestPoint.generatedAtLabel}</span>
              </div>
            </article>
          );
        })}
      </div>
    </article>
  );
}

function SnapshotView({ snapshot, history, refreshing, onRefresh }) {
  const totalUnits = snapshot.chips.reduce((sum, chip) => sum + chip.totalAvailableUnits, 0);

  return (
    <>
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Live GPU Board</p>
          <h1>{snapshot.title}</h1>
          <p>{snapshot.subtitle}</p>
          <div className="hero-actions">
            <button type="button" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh Snapshot"}
            </button>
            <span className="api-pill">{SNAPSHOT_PATH}</span>
          </div>
        </div>
        <div className="metric-grid">
          <MetricCard label="Generated" value={formatGeneratedAt(snapshot)} tone="warm" />
          <MetricCard label="Live Sources" value={snapshot.sources.length} tone="cool" />
          <MetricCard label="Source Gaps" value={snapshot.sourceGaps.length} tone="calm" />
          <MetricCard label="Visible Units" value={formatUnits(totalUnits)} tone="neutral" />
        </div>
      </header>

      <section className="chip-grid" aria-label="GPU families">
        {snapshot.chips.map((chip) => (
          <ChipCard key={chip.chip} chip={chip} />
        ))}
      </section>

      <section className="dashboard-grid">
        <HistoryView history={history} />

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Provider Comparison</p>
              <h2>Observable units by provider and chip</h2>
            </div>
            <p className="panel-note">Bars are scaled to the largest provider signal in this snapshot.</p>
          </div>
          <div className="provider-columns">
            {snapshot.chips.map((chip) => (
              <section key={chip.chip} className="provider-column">
                <div className="provider-column-header">
                  <h3>{chip.label}</h3>
                  <span>{formatUnits(chip.totalAvailableUnits)}</span>
                </div>
                {chip.providers.map((provider) => (
                  <ProviderRow key={`${chip.chip}-${provider.providerId}`} provider={provider} maxUnits={snapshot.maxAvailableUnits} />
                ))}
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Source Coverage</p>
          <h2>Reachable public sources</h2>
          <ul className="detail-list">
            {snapshot.sources.map((source) => (
              <li key={source.id}>
                <strong>{source.name}</strong>
                <span>{source.liveAvailabilityType}</span>
              </li>
            ))}
            {snapshot.sourceFailures.map((failure) => (
              <li key={failure}>
                <strong>Failure</strong>
                <span>{failure}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <p className="eyebrow">Collection Notes</p>
          <h2>Methodology and gaps</h2>
          <ul className="bullet-list">
            {snapshot.methodology.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {snapshot.sourceGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </article>
      </section>
    </>
  );
}

function ErrorState({ message, onRetry, busy }) {
  return (
    <section className="state-panel" role="alert">
      <p className="eyebrow">API Error</p>
      <h1>Live snapshot unavailable</h1>
      <p>{message}</p>
      <button type="button" onClick={onRetry} disabled={busy}>
        {busy ? "Retrying..." : "Try Again"}
      </button>
    </section>
  );
}

function LoadingState() {
  return (
    <section className="state-panel" aria-busy="true">
      <p className="eyebrow">Connecting</p>
      <h1>Loading the live GPU board...</h1>
      <p>Waiting for the Node API to return the latest public availability snapshot.</p>
    </section>
  );
}

export default function Page() {
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadSnapshot(forceRefresh = false) {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const nextState = await loadDashboard(forceRefresh);
      setSnapshot(nextState.snapshot);
      setHistory(nextState.history);
      setError("");
      setWarning(nextState.warning);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      try {
        const nextState = await loadDashboard();

        if (!cancelled) {
          setSnapshot(nextState.snapshot);
          setHistory(nextState.history);
          setError("");
          setWarning(nextState.warning);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialLoad();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleRefresh() {
    startTransition(() => {
      void loadSnapshot(true);
    });
  }

  return (
    <main className="page-shell">
      {loading && !snapshot ? <LoadingState /> : null}
      {!loading && error && !snapshot ? <ErrorState message={error} onRetry={handleRefresh} busy={refreshing} /> : null}
      {snapshot ? <SnapshotView snapshot={snapshot} history={history} refreshing={refreshing} onRefresh={handleRefresh} /> : null}
      {snapshot && (error || warning) ? (
        <p className="inline-warning" role="status">
          Latest refresh warning: {error || warning}
        </p>
      ) : null}
    </main>
  );
}
