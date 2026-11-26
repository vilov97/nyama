import { useState } from "react";
import { inputCls } from "./AuthLayout";

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
};

/** Password field with a Show/Hide toggle (helps on mobile + typo-prone logins). */
export default function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: Props) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        required
        autoComplete={autoComplete}
        className={`${inputCls} pr-16`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer px-1 py-1 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-400 transition-colors hover:text-neutral-900"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
