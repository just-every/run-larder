# Getting started

Run Larder on your own computer, become its owner, and work through the five first steps on Today.

## 1. Get Larder and start it

Larder runs with `rer`, the Run Edit Run command, on macOS, Linux or Windows with WSL2. One line, the same as on the [Run page](https://run-larder.com/run), installs `rer` and starts Larder:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-larder
```

Git is required; rer brings Node and pnpm. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-larder` does the same. The installer puts `rer` in your home folder; if it prints a line that puts `rer` on your PATH, run that line too.

To start it again later, run the same line from the same folder, or `cd run-larder && rer dev`. `rer dev` installs everything Larder needs, makes you the owner and prints a line starting `RER_OPEN` with a link. Open that link on the same computer: Larder opens signed in as you. Treat the link like a password; anyone who has it is signed in as the owner.

To set up for a real mailbox instead of the local one, set Larder up first with your email, then start it:

```sh
npx -y @runeditrun/rer setup just-every/run-larder --owner-email you@example.com
cd run-larder
rer dev
```

## 2. Finish setup

The first time you open the app, Larder asks you to review the owner of this installation: your name and email. Tick **I confirm this owner account is ready to use.** and press **Finish setup**. Until you do, the installation's home page says it is waiting for its owner.

A new installation starts empty. There are no sample items, stock or orders; everything you see is what you or your team recorded.

## 3. The five first steps

**Today** shows a **Getting started** card until each step is done:

1. **Add your locations and items, or move them in from Odoo.** Add them under **More → Items, contacts and locations**, or bring them across with [Move in from Odoo](move-in.md).
2. **Record counted opening stock with its evidence.** On **Stock**, record what is on each shelf, when it was counted, who counted it and the count sheet or photo. See [Stock and counts](stock.md).
3. **Give each made item a bill of materials.** Under **Make & buy → Bills of materials**. See [Make and buy](make-and-buy.md).
4. **Confirm your first order and reserve its stock.** See [Take an order](orders.md).
5. **Invite your team and give each person a role.** See [People and roles](people-and-roles.md).

Each step ticks itself off when the record exists. When all five are done the card goes away and Today shows only what needs attention.

## 4. Every morning

**Today** answers what needs attention: an **Exceptions** list (what is short, late, quarantined, unreconciled or rejected in a move-in) and **Needs a person** (drafts and proposals waiting for someone with the authority to approve them). The red count beside **Today** in the menu is the number of items on that page.

Stop Larder with `rer dev --stop` or Ctrl-C. Your records stay on this computer in the checkout's `.wrangler/state` folder; [Backup and restore](backup-and-restore.md) shows how to keep a copy.
