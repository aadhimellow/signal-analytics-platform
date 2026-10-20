# Interview prep: how to present and defend this

## 60-second pitch
"I built an end-to-end signal analytics platform: a deterministic virtual PLC produces six correlated signals at 20 ms; an ingest engine bulk-writes them to Postgres, maintains 1-second rollups and runs a hybrid anomaly detector; the UI has live monitoring, historical analytics with normal-vs-abnormal comparison and an incident explorer. The key design decision was making detection explainable and robust to legitimate operating changes, and I tested that explicitly."

## Map it to your resume (they said round 1 was resume-based)
- **HBase row-key / scan optimisation (45 -> 4 min, 25 -> <1 min)** -> composite PK `(mill, signal, ts)` + range scans, BRIN on ts, rollups to avoid scanning raw data.
- **Kafka + Spark Streaming telematics** -> same shape: stream ingest, windowed features, event detection (crash/event detection ~ cobble detection). Say what you'd swap in at scale: Kafka topic per plant, Spark/Flink windowing, TimescaleDB/ClickHouse sink.
- **Data skew / cartesian explosion at EY** -> you partition by (mill, signal) and bucket by time; no hot keys.
- **Medallion architecture** -> raw readings (bronze), 1 s rollups (silver), alerts/incidents (gold).
- **EMR autoscaling / cost** -> retention policy + rollups keep storage and cost bounded (raw 1 h + incident windows).
- **GenAI work (TCS)** -> natural extension: LLM that summarises an incident from the alert's JSON details ("root-cause hypothesis"). Mention it as next step, not as done.

## Questions to expect (with short answers)
1. **Why Postgres, not Timescale/InfluxDB/Kafka?** Free-tier friendly and deployable on Vercel; schema is hypertable-ready. At real scale: Kafka -> Timescale/ClickHouse, compression, continuous aggregates.
2. **Why no worker on Vercel?** Serverless has no long-lived process, so the virtual PLC is cursor-based and lazily advanced under an advisory lock; an external simulator over the ingest API covers the "real" edge path.
3. **How do you avoid false alarms on load changes?** Lagged robust baseline + multi-signal shape (current & torque up *while speed falls* or vibration bursts) + persistence; load changes are slow and move speed up. Tested.
4. **How would you handle late / out-of-order / duplicate data?** Idempotent inserts (PK + ON CONFLICT), detection re-run over the affected range + 12 s context, alerts merged not duplicated.
5. **How would it scale to 1000 signals x 50 Hz?** 50k msg/s: batch at the edge, Kafka partitioned by mill, columnar/Timescale storage with compression, detection as a streaming job, downsample at write time.
6. **Thresholds are hand-tuned. Is that OK?** Explain: chosen from the physics, explainable to operators; next step is tuning on labelled incidents and adding Isolation Forest/autoencoder alongside.
7. **What's the detection latency / precision?** ~1.2 s; 0 false positives on seeded normal + load change; honest caveat: synthetic data.
8. **Security?** Middleware-enforced auth, bcrypt, httpOnly JWT, API key for ingest, parameterised SQL. Gaps: no rate limiting / refresh tokens / RBAC yet.

## Questions about the twin and scrubber
- **Is the twin hard-coded to the scenario?** No. `phaseOf()` uses only signal ratios vs nominal (current & torque > 1.5x with speed < 0.92x or vibration > 1.5x = cobble), so it works for any producer, including the real ingest API. It is a visualisation; alerts come from the detector.
- **Where do the scrubber frames come from?** Raw 20 ms rows in Postgres around the alert. Retention keeps +-60 s around every alert, so the incident can always be replayed even after the 1 h raw retention purges everything else.
- **Why is scrubbing smooth at 50 fps?** The 6x500-point chart is memoised SVG; only the cursor, the table and the twin re-render per frame, and playback runs on requestAnimationFrame.

## Demo script (3 minutes)
1. Login -> Live: point out 50 Hz source / downsampled charts, status badge.
2. Click **Inject cobble** -> status turns ALARM within ~2-3 s; open the alert.
3. Incident page: scrub the 20 ms frames (use Peak, then step +-20 ms) and watch the twin buckle and the table go red; then the normal-vs-incident table and per-signal charts.
4. History: pick last 15 min, show normal vs abnormal summary.
5. Mention the load change at +150 s that did **not** alert, and show it in History.
6. Terminal: `npm run simulate -- --replay-from ...` to show the same incident via the ingest API.
