"""JobSpy sidecar — invoked by the Prospector as a subprocess.

Usage: python scrape.py            (writes JSON lines to stdout)
Setup: python -m venv .venv && .venv\\Scripts\\pip install python-jobspy

Scrapes Indeed + LinkedIn for agent-stack hiring signals. Each posting that
mentions an agent framework is emitted as a lead for the scoring pipeline.
"""
import json
import sys

SEARCHES = ["LangGraph", "CrewAI", "AutoGen agents", "agentic engineer", "AI agents production"]
KEYWORDS = ["langgraph", "crewai", "autogen", "agentic", "openai agents", "bedrock agents"]

def main() -> None:
    try:
        from jobspy import scrape_jobs  # type: ignore
    except ImportError:
        print(json.dumps({"error": "python-jobspy not installed — run services/jobspy setup"}), file=sys.stderr)
        sys.exit(2)

    seen: set[str] = set()
    for term in SEARCHES:
        try:
            jobs = scrape_jobs(
                site_name=["indeed", "linkedin"],
                search_term=term,
                results_wanted=25,
                hours_old=24 * 14,
                country_indeed="USA",
            )
        except Exception as exc:  # one failing board/search must not kill the run
            print(json.dumps({"warn": f"{term}: {exc}"}), file=sys.stderr)
            continue

        for _, row in jobs.iterrows():
            url = str(row.get("job_url") or "")
            if not url or url in seen:
                continue
            seen.add(url)
            blob = " ".join(str(row.get(k) or "") for k in ("title", "description", "company"))
            if not any(kw in blob.lower() for kw in KEYWORDS):
                continue
            print(
                json.dumps(
                    {
                        "source": "jobspy",
                        "url": url,
                        "text": f"Job post by {row.get('company')}: {row.get('title')} — "
                        + str(row.get("description") or "")[:1500],
                        "postedAt": None,
                    }
                )
            )

if __name__ == "__main__":
    main()
