"""JobSpy sidecar — invoked by the Prospector and Signal Scout as a subprocess.

Usage:
  python scrape.py
  python scrape.py --sites linkedin --hours 48

Setup: python -m venv .venv && .venv\\Scripts\\pip install python-jobspy

Scrapes job boards (Indeed + LinkedIn by default) for agent-stack hiring signals.
Each posting that mentions an agent framework is emitted as one JSON line on stdout.
"""
import argparse
import json
import sys

SEARCHES = ["LangGraph", "CrewAI", "AutoGen agents", "agentic engineer", "AI agents production"]
KEYWORDS = ["langgraph", "crewai", "autogen", "agentic", "openai agents", "bedrock agents"]

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sites", default="indeed,linkedin", help="Comma-separated boards: indeed, linkedin")
    parser.add_argument("--hours", type=int, default=24 * 14, help="Max age of postings in hours")
    args = parser.parse_args()
    site_name = [s.strip() for s in args.sites.split(",") if s.strip()]

    try:
        from jobspy import scrape_jobs  # type: ignore
    except ImportError:
        print(json.dumps({"error": "python-jobspy not installed — run services/jobspy setup"}), file=sys.stderr)
        sys.exit(2)

    seen: set[str] = set()
    for term in SEARCHES:
        try:
            jobs = scrape_jobs(
                site_name=site_name,
                search_term=term,
                results_wanted=25,
                hours_old=args.hours,
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
            company = str(row.get("company") or "unknown")
            title = str(row.get("title") or "")
            print(
                json.dumps(
                    {
                        "source": "jobspy",
                        "url": url,
                        "text": f"Job post by {company}: {title} — "
                        + str(row.get("description") or "")[:1500],
                        "author": company,
                        "company": company,
                        "title": title,
                        "postedAt": None,
                    }
                )
            )

if __name__ == "__main__":
    main()
