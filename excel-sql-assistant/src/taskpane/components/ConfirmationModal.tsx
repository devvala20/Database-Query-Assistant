/**
 * ConfirmationModal.tsx — Data Mutation Confirmation Dialog
 *
 * Appears whenever an operation (DELETE, UPDATE, DROP, INSERT, ALTER)
 * is requested, ensuring the user confirms before running and reassuring
 * them that a 7-day safety snapshot is saved.
 */

import "./ConfirmationModal.css";

interface Props {
  sql: string;
  operationType?: string;
  targetTable?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationModal({
  sql,
  operationType = "MODIFICATION",
  targetTable,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="confirm-modal">
        <div className="confirm-modal__header">
          <span className="confirm-modal__icon" aria-hidden="true">⚠️</span>
          <div className="confirm-modal__title-group">
            <h2 id="confirm-title" className="confirm-modal__title">
              Confirm {operationType} Operation
            </h2>
            <span className="confirm-modal__subtitle">User confirmation required</span>
          </div>
        </div>

        <div className="confirm-modal__body">
          <p className="confirm-modal__desc">
            This SQL statement will modify or remove data
            {targetTable ? (
              <> in table <strong>"{targetTable}"</strong></>
            ) : null}
            . Are you sure you want to proceed?
          </p>

          <div className="confirm-modal__sql-box">
            <pre className="confirm-modal__sql">{sql}</pre>
          </div>

          <div className="confirm-modal__backup-card">
            <span className="confirm-modal__backup-icon" aria-hidden="true">🛡️</span>
            <div>
              <strong>Automatic 7-Day Safety Backup:</strong>
              <div>
                A full snapshot of {targetTable ? `"${targetTable}"` : "the affected data"} will be preserved in your Recycle Bin for 7 days before this change is executed. You can restore it anytime.
              </div>
            </div>
          </div>
        </div>

        <div className="confirm-modal__footer">
          <button
            type="button"
            className="confirm-modal__btn confirm-modal__btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-modal__btn confirm-modal__btn--confirm"
            onClick={onConfirm}
          >
            Confirm & Execute
          </button>
        </div>
      </div>
    </div>
  );
}
