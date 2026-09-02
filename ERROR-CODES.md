# Tasq error codes

When the board shows or logs a code like `TASQ-E0404`, find it here. Each code
has one line: what it means, then what to do. Codes never change meaning, so
this page stays valid across updates. If a code is not on this page, it is not
from Tasq — something else on the Mac is talking.

## Sign-in and people (01xx)

| Code | What it means | What to do |
|------|---------------|------------|
| TASQ-E0101 | Not signed in. | Sign in with your PIN; if names are missing, the admin needs to add people in Settings. |
| TASQ-E0102 | Admins only. | Only the owner/admin can do this. Ask them. |
| TASQ-E0103 | Wrong PIN. | Re-enter it. PINs are set by each person the first time they sign in. |
| TASQ-E0104 | Locked out from too many wrong tries. | Wait for the lockout to pass (it says how long on screen), then try again. |
| TASQ-E0105 | PIN must be exactly 4 digits. | Pick 4 digits, no letters. |
| TASQ-E0106 | The two PINs entered did not match. | Set the PIN again, typing both boxes the same. |
| TASQ-E0107 | That person already has a PIN. | They should sign in with their existing PIN, or the admin can reset it in Settings. |
| TASQ-E0108 | That person has no PIN yet. | They need to set one on first sign-in; if the prompt is not showing, ask the admin to re-add them. |
| TASQ-E0109 | That person is not on the board anymore. | The admin can re-add them in Settings, People. |
| TASQ-E0110 | The server has no session secret. | Restart the board with start.command — it generates one automatically. If it persists, check .env.local is in the app folder. |
| TASQ-E0111 | Too many attempts from this device. | Wait about a minute; the limit clears on its own. |

## Tasks (02xx)

| Code | What it means | What to do |
|------|---------------|------------|
| TASQ-E0201 | Task no longer exists. | Someone deleted it — pull down to refresh. |
| TASQ-E0202 | Task was cancelled. | It is off the board; pull down to refresh. |
| TASQ-E0203 | Task already done. | Tap the next thing. |
| TASQ-E0204 | Someone claimed it first. | First come first served — it is theirs now. |
| TASQ-E0205 | Only admins add tasks. | Tell the owner what needs doing; they post it. |
| TASQ-E0206 | Task needs a title. | Type what needs doing, in plain words. |
| TASQ-E0207 | Assigned person left the board. | Admin: edit the task and pick someone else, or set it to Anyone. |
| TASQ-E0208 | The due time did not parse. | Re-pick the date and time from the picker. |
| TASQ-E0209 | Only creator or admin can edit. | Ask them. |
| TASQ-E0210 | Only creator or admin can cancel. | Ask them. |
| TASQ-E0211 | Task changed under you. | Pull down to refresh and try again. |

## Supplies (03xx)

| Code | What it means | What to do |
|------|---------------|------------|
| TASQ-E0301 | Item box empty. | Say what you need, e.g. "2 tubes of grease". |
| TASQ-E0302 | Admins move requests along. | Ask the owner to order it. |
| TASQ-E0303 | Request already gone. | Pull down to refresh. |
| TASQ-E0304 | Unknown status. | Refresh the page; if it persists, note the code and contact support. |
| TASQ-E0305 | Status moves one step at a time. | Use the buttons in order: requested, ordered, received. |
| TASQ-E0306 | Someone moved it first. | Pull down to refresh. |

## Notifications (04xx)

| Code | What it means | What to do |
|------|---------------|------------|
| TASQ-E0401 | Not signed in. | Sign in, then try notifications again. |
| TASQ-E0402 | Device subscription unreadable. | Turn notifications off then on again in Settings. |
| TASQ-E0403 | Server could not read the request. | Try again; if it repeats, note the code. |
| TASQ-E0404 | That device belongs to someone else. | Sign in as yourself on this device, then enable notifications. |
| TASQ-E0405 | Too many notification changes. | Wait a minute. |
| TASQ-E0406 | No subscription found for this device. | It was already off — nothing to do. |

## First-time setup (05xx)

| Code | What it means | What to do |
|------|---------------|------------|
| TASQ-E0501 | Setup code wrong or used. | The one-time code is printed in the board window and saved next to the database (data/setup-code.txt). It works once. |
| TASQ-E0502 | Board already set up. | Sign in normally; setup is behind you. |
| TASQ-E0503 | Name too short. | Use at least two characters. |
| TASQ-E0504 | Name taken. | Pick a slightly different name. |
| TASQ-E0505 | PIN must be 4 digits. | Digits only. |
| TASQ-E0506 | PINs did not match. | Start the PIN over. |
| TASQ-E0507 | Too many setup attempts. | Wait as long as it says on screen, then re-enter the code. |

## Everything else (06xx)

| Code | What it means | What to do |
|------|---------------|------------|
| TASQ-E0601 | Database busy or locked. | Wait a few seconds and retry. If it persists, close other Tasq windows — one copy at a time. |
| TASQ-E0602 | Catch-all server error. | Try again. If it repeats, note what you were doing and contact support with this code. |
