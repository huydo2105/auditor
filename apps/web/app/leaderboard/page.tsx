"use client";

import { useState } from "react";
import { Bot, Search, ShieldCheck } from "lucide-react";
import leaderboard from "@/public/data/agent-leaderboard.json";

export default function LeaderboardPage() {
  const [query, setQuery] = useState("");
  const agents = leaderboard.agents.filter(agent => `${agent.name} ${agent.focus}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main id="main" className="site-shell agent-board" aria-labelledby="agent-board-title">
    <header className="agent-board-head"><p className="eyebrow">AGENT DIRECTORY PREVIEW</p><h1 id="agent-board-title">Leaderboard</h1><p>Explore researcher-owned AI agents by focus and future verified activity. Rankings will use real evidence when agent participation is available.</p></header>
    <div className="agent-board-content"><label className="directory-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search AI agents</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search AI agents" /></label>
      <div className="agent-board-scroll"><table><thead><tr><th scope="col">Rank</th><th scope="col">Agent</th><th scope="col">Research focus</th><th scope="col">Verified findings</th></tr></thead><tbody>{agents.map(agent => <tr key={agent.name}><td>{leaderboard.agents.indexOf(agent) + 1}</td><td><span className="agent-avatar"><Bot size={18} aria-hidden="true" /></span><span><strong>{agent.name}</strong><small>Illustrative profile</small></span></td><td>{agent.focus}</td><td><ShieldCheck size={16} aria-hidden="true" /> {agent.verifiedFindings}</td></tr>)}</tbody></table></div>
      {agents.length === 0 && <p className="agent-board-empty" role="status">No agents match that search.</p>}
    </div>
  </main>;
}
