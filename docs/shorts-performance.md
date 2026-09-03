# KFTP Shorts performance log

One row per Short. The point is to accumulate enough rows to tell a real pattern
from the feed lottery — at n=12 almost nothing is separable, so resist reading
causes into any single row.

## Standing metric set

| metric | where | why this one |
|---|---|---|
| **Stayed to watch %** | Engagement | the signal the Shorts feed actually runs on |
| **Avg view duration** | Engagement | >100% of length means loops, which is the strongest positive |
| **Views @24h / @7d** | Overview | early numbers are not verdicts on this channel |
| **Engaged views** | Engagement | views that weren't an instant swipe |

## Log

| date | len | title | views | stayed | avg dur | posted | note |
|---|---|---|---|---|---|---|---|
| 08-19 | 0:18 | 0.05 Delta Means 95% Odds | 11 | – | – | 16:00 | |
| 08-20 | 0:27 | Delta Says Safe. Gamma Says Wait. | 493 | – | – | 16:30 | caught |
| 08-21 | 0:39 | This Order Shouldn't Have Filled | 81 | – | – | 09:00 | |
| 08-21 | 0:35 | A Repair Shouldn't Use the Same Rules | 20 | – | – | 16:00 | |
| 08-24 | 0:24 | Why Win Rate Alone Tells You Nothing | 28 | – | – | 18:00 | |
| 08-25 | 0:27 | I Designed a Table We'd Already Built | 24 | – | – | 16:00 | |
| 08-25 | 0:21 | To Win This Trade, They Have to Miss | 18 | – | – | 09:00 | |
| 08-26 | 0:42 | We Exited. Then It Landed Right Where We Wanted | 15 | – | – | 16:00 | |
| 08-27 | 0:27 | It Stopped Being a Side Project | 563 | – | – | 09:00 | caught |
| 08-28 | 0:35 | It Was Timing. Twice I Said It Wasn't. | 741 | – | – | 17:00 | caught |
| 09-01 | 0:32 | You can't ship a database migration and hope | 494 | 22.7% | 0:14 (42%) | 16:00 | caught · +1 sub |
| 09-02 | 0:41 | Your unit test passes. It proves nothing. | 5 | 100% | 1:35 (232%) | 09:00 | not served |

## What the data rules OUT (2026-09-02, n=12)

**Tags.** The 494-view and the 5-view Short carry a byte-identical keyword string.
Same tags, 100x difference. Tags are also a minor signal for Shorts generally —
the feed runs on watch-through, not metadata.

**Post time.** 09:00 produced both the 563 and the 5. 16:00 produced both the 494
and the 11. No relationship.

**Length.** Winners average 30.3s, losers 30.9s. The shortest Short on the
channel (0:18) got 11 views; a 0:35 got 741.

**Title construction.** A theory that first-person/reversal titles outperform does
not survive the full set: "Delta Says Safe. Gamma Says Wait." (493) and "It
Stopped Being a Side Project" (563) are neither.

## What the data actually shows

The outcome is bimodal: 4 of 12 landed 490-740, the other 8 landed 11-81. Nothing
in the metadata separates the groups. That is what the Shorts feed looks like on a
small channel — a small test audience that either converts and cascades, or
doesn't.

**The 09-02 Short is not a content failure.** 100% stayed to watch and an average
view duration of 1:35 on a 0:41 video means every viewer watched it through
roughly 2.3 times. That is far better than the channel's best-performing Short
(22.7% stayed, 42% viewed). It is a sample of five, so it proves little — but
every signal available points the opposite way from "the content is wrong".

**The ceiling is distribution, not retention.** Even a Short that lands 494 views
is swiped away 77.3% of the time. Retention is not what separates a hit here;
being served at all is.

The honest strategy that follows: keep the cut quality where it is, keep posting,
and let the count of attempts do the work. Revisit this file at n=25+ — that is
roughly where a real difference would start to be visible above the lottery.
