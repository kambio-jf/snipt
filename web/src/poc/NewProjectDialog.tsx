import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useCreateProject } from "./queries.js";
import styles from "./NewProjectDialog.module.scss";

// Radix gives us the *behavior* of an accessible modal — focus trap, ESC to
// close, scroll lock, aria wiring, the overlay — and zero opinion on looks.
// Every pixel below is styled by us in NewProjectDialog.module.scss. This is how
// you get accessibility without adopting a pre-styled UI kit.
export function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateProject();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync(name.trim());
    setName("");
    setOpen(false); // the list refetches on its own via cache invalidation
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={styles.trigger}>New project</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>New project</Dialog.Title>
          <Dialog.Description className={styles.desc}>
            Give it a name. You can rename it later.
          </Dialog.Description>
          <form onSubmit={submit} className={styles.form}>
            <input
              autoFocus
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2026-07-20 episode"
            />
            {create.isError && <p className={styles.err}>Couldn’t create project.</p>}
            <div className={styles.actions}>
              <Dialog.Close className={styles.btn}>Cancel</Dialog.Close>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
