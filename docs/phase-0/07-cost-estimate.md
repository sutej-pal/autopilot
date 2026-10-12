# Cost estimate

## Decision (2026-10-12): prove it locally before any cloud bill

The product is tested on this PC until a recorded workflow replays and passes its success check. That path is **$0**. No AWS account, NAT gateway, load balancer, Fargate, RDS, or KMS.

The AWS free tier is the wrong place to run this stack, even as a trial:

- The free EC2 shape is about 1 GB of RAM. Chromium plus the API on that instance is expected to run out of memory. This is not a measurement yet; it is why we are not trying it.
- NAT Gateway, an application load balancer, and Fargate are not included in the free tier. Those three lines are most of the ~$340 floor below.
- RDS and S3 have free-tier allowances, and the SES sandbox can mail verified addresses at no charge. None of that helps until a browser run has succeeded.

If a local replay of the timesheet works, the next hosting step is a decision, not an automatic deploy of the production sketch. A single small VM is the likely bridge. The multi-AZ layout stays the scale design. Nothing in AWS is created until you ask for it.

These production figures below are planning numbers, not a quote. They were **not** pulled from the AWS Price List API, and nothing was deployed. Treat them as order-of-magnitude.

Method: public us-east-1 on-demand list prices remembered for the main ECS, RDS, NAT, and ALB meters, then **+10%** as a rough stand-in for `ap-south-1`. Fargate is Linux/x86. Prices move; recompute before Phase 5 with the pricing API or the AWS calculator.

Fargate meters used (us-east-1, before the 10%): about $0.04048 per vCPU-hour and $0.004445 per GB-hour.

## Idle platform

Assumes Multi-AZ Postgres, one NAT gateway, one ALB, a small Redis node, two API tasks, two scheduler tasks, two watchdog tasks, one warm recorder, and one minimum worker so a run does not wait for a cold Fargate start. Worker scale-from-zero is cheaper and slower; the reliability doc explains why the queued-too-long alarm has to move if you choose zero.

| Component | Sketch (USD / month) |
| --- | --- |
| NAT gateway (base, little data) | 37 |
| Application load balancer | 22 |
| RDS Postgres, small Multi-AZ | 50 |
| ElastiCache, small node | 15 |
| API, 2 × (0.5 vCPU, 1 GB) | 40 |
| Scheduler, 2 × (0.25 vCPU, 0.5 GB) | 20 |
| Watchdog, 2 × (0.25 vCPU, 0.5 GB) | 20 |
| Warm recorder, 1 × (1 vCPU, 2 GB) | 40 |
| Minimum worker, 1 × (2 vCPU, 4 GB) | 79 |
| S3, KMS, Secrets Manager, logs, Route 53 | 17 |
| **Floor** | **about 340** |

The floor is the bill. Runs are not.

A development account without Multi-AZ, without a warm worker, and with scheduler/watchdog at one task each can sit nearer **$150–200 / month** and will not meet the "kill one scheduler and still fire" goal. Do not use the cheap sketch as the production design.

NAT plus the always-on browser tasks dominate. That is the main cost risk, not SES and not S3.

## Marginal cost of one run

Assume a 3-minute timesheet on the 2 vCPU / 4 GB worker, a handful of masked screenshots, and no long video.

| Piece | Sketch |
| --- | --- |
| Fargate for 3 minutes | about $0.005 |
| S3 PUT and 30-day storage of ~10 MB | under $0.001 |
| Logs | under $0.001 |
| **Per run** | **about $0.01** |

A 10-minute recording session on a warm recorder is mostly bandwidth: on the order of 50–150 MB of JPEG egress if the screencast stays near 8 fps. At typical internet-egress plus NAT data-processing rates that is a few cents, not dollars. Throttling idle frames to 2 fps is the control.

SES is $0.10 per 1,000 messages. Failure email does not move the bill. Reputation and sandbox limits matter more than price.

## A concrete month

30 employees, one weekday timesheet each, about 22 weekdays, plus one re-record each:

- 660 runs × ~$0.01 ≈ $7
- 30 recordings × a few cents ≈ $1
- Idle floor ≈ $340

**About $350 for the month**, almost all of it idle infrastructure. This does not include support time, a second environment, or WAF.

At a few hundred runs a day the variable compute starts to matter and the worker minimum should be replaced by queue-depth scaling. Under that load, revisit 2 vCPU / 4 GB after measuring the real portal. Those task sizes are guesses.

## Costs not in the table

- SES production-access review: no dollar cost, calendar time.
- Human time when a portal changes its DOM. Healed locators reduce this; they do not remove it.
- A self-hosted runner later shifts browser compute to the customer and does not remove the control plane.
- Cross-AZ data charges if tasks and RDS are placed carelessly. Keep tasks in the same AZs as the database subnets where the service allows it.

## What would make this estimate wrong

- Chromium needs more than 4 GB on the real portal (likely direction: up).
- Cold-start policy left at zero while alarms assume a warm worker.
- Video stored for every run. A few megabytes is cheap; full traces for every step are not free at retention and are a security cost more than a dollar cost.
- Two NAT gateways for AZ independence roughly doubles the NAT line.
