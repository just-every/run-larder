# Backup and restore

Keep a copy of your business records, and bring them back into an empty installation.

Larder has two kinds of copy. The **business archive** is made in the app and holds your Larder records. The **installation backup** is made with `rer` and holds the whole installation, including your team's sign-in accounts.

## The business archive

On **More → Business archive**, the owner or a manager presses **Download archive**. The file holds every record, the full movement ledger, reservations, approvals, attachments such as count sheets, and every recorded action, with a checksum.

To restore, the owner opens **Restore** in an empty installation and chooses the file. Larder checks the checksum first and writes nothing if the file was changed, and checks that every stock position matches the archive. Restore only works into an empty installation, so it can never mix two sets of records.

## The installation backup

From the Larder folder, stop the app and export:

```sh
rer dev --stop
rer export --output exports/installation.rer
```

To restore it, for example on a new computer or after starting over, import it into an empty installation:

```sh
rer reset --yes
rer import --input exports/installation.rer --yes
rer dev
```

When Larder opens on the restored records, confirm the owner on **Finish setup** once more; every record, movement and team member is back.

`rer reset --yes` deletes this computer's Larder data, so export first. `rer import` refuses an installation that already has records, and checks the whole file before it writes anything. Private settings such as the session secret stay in this folder's private settings file and are not in the backup.

## How often

Export after each move-in, before you change computers, and on a regular day each week. Keep the files somewhere other than the computer Larder runs on.
