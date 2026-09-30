"use client";

export default function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-20 bg-black/30 flex items-start sm:items-center justify-center p-4 overflow-auto">
      <div className="bg-white rounded-lg p-5 max-w-md w-full space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs text-neutral-500 underline">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
