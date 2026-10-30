# Testing the Coal & Ash tender workflow

Open http://localhost:3000. Every account uses the password **CoalAsh@2026**.
Sign out from your name (top right) before switching accounts.

| Account | Email | Does |
|---|---|---|
| Tender Coordinator | coordinator@coalandash.local | Uploads, validates, assigns bid submitter |
| Vishesh | vishesh@coalandash.local | Relevance review, final costing, EMD clarification |
| Ranjana | ranjana@coalandash.local | Relevance review, draft costing |
| Sundarlingam | sundarlingam@coalandash.local | Draft costing |
| Sales Team | sales@coalandash.local | Sales costing input |
| Department Head | depthead@coalandash.local | Approves final costing |
| Krishnanath / Surya M | krishnanath@ / surya@coalandash.local | Bank guarantee |
| Sanjeev | sanjeev@coalandash.local | ISB / surety bond |
| Bid Submitter | submitter@coalandash.local | Submits the bid and uploads proof |
| Administrator | admin@coalandash.local | Settings, SLAs, holidays |

Each person's open tasks are in **My worklist** (the number on the menu icon). Emails are not sent yet; every notice appears under **Notifications**.

---

## Test A — full happy path (bank guarantee)

| # | Sign in as | Do this | You should see |
|---|---|---|---|
| 1 | Coordinator | New tender → upload `1-notice-complete-bank-guarantee.txt` → Upload and extract | A new CA-2026-xxxx record. Progress bar on "Data validation". Tender details shows 44 extracted. |
| 2 | Coordinator | Tender details tab → scroll down → tick the box → Submit for relevance review | Progress moves to "Relevance review". |
| 3 | Vishesh (or Ranjana) | Worklist → Open task → Approve | Costing **and** EMD both start at once. The other reviewer's task disappears. |
| 4 | Ranjana or Sundarlingam | Draft costing task → write assumptions → attach `5-draft-costing-sheet.txt` → Mark completed | Task moves to Sales Team. |
| 5 | Sales Team | Attach `6-sales-input-sheet.txt` → Mark completed | Task moves to Vishesh. |
| 6 | Vishesh | Final costing → amount `97200000` → attach `7-final-costing-sheet.txt` → Mark completed | Task moves to Department Head. |
| 7 | Department Head | Approve | Costing shows Approved. |
| 8 | Krishnanath (or Surya M) | Bank guarantee task → amount `1960000`, beneficiary `CSPGCL`, reference `TESTBG/2026/0091`, attach `8-emd-evidence.txt` → Mark verified | EMD shows Completed. Steps 4–7 and 8 can be done in any order. |
| 9 | Coordinator | Overview → Manage this tender → Show → choose Bid Submitter → Assign submitter | Readiness checklist reaches 7/7 and the status becomes **Ready to Bid**. |
| 10 | Bid Submitter | Bid submission task → status "Bid submitted — evidence recorded" → today's date and time → reference `ACK-2026-55321` → attach `9-bid-acknowledgement.txt` → Record submission | Status **Bid Submitted — Evidence Recorded**. |
| 11 | Coordinator | Manage this tender → Tender outcome → Won → Record outcome | Tender closes as Won. The dashboard counts update. |

## Test B — missing fields, then the ISB route

1. **Coordinator**: upload `2-notice-missing-fields-isb.txt`.
2. Tender details → tick **Show only the fields that need attention**. About 31 fields are listed.
3. Fill a few (for example Bid opening date `29/01/2027 16:00`), then **Save corrections**. You should see "N fields saved."
4. Type a wrong date such as `29 Jan` in Bid opening date and save. You should get a warning asking for DD/MM/YYYY HH:MM.
5. Submit for relevance review. Fields you left blank are recorded as "Not Found in Document".
6. **Vishesh** approves. The EMD task goes to **Sanjeev** (ISB), not Accounts.

## Test C — unclear EMD

1. Upload `3-notice-unclear-emd.txt`, validate, and approve as Vishesh.
2. **Vishesh** gets an "EMD clarification" task. Nothing is assumed: choose the instrument and give a reason, and the correct EMD task is created.

## Test D — corrigendum and deadline change

1. Open the Test A tender (before step 10) → Documents tab → type **Notice / corrigendum** → upload `4-corrigendum-for-notice-1.txt`.
2. Bid submission end date shows as a **conflict** (15/01 vs 22/01). Notifications shows a deadline-change notice once you correct the field to `22/01/2027 15:00`.

## Test E — rejection

Upload any notice, validate it, then as Ranjana click **Reject** without a comment. It is refused. Add a reason and reject. The tender closes and no costing or EMD tasks are created.

## Test F — duplicate protection

Upload `1-notice-complete-bank-guarantee.txt` a second time. You are sent to the existing record and no second workflow starts.

## Other things to try

- **Department Head → Return for revision** at step 7: the task goes back to the chosen costing step with your comment.
- **Bid Submitter → "evidence recorded" without a file**: refused. Proof is required.
- **Administrator → Administration**: change working hours, add a holiday, or shorten an SLA to see due times move.

## Starting again with clean data

This wipes every tender and restores the demo records:

```bash
npm run db:setup
```
