import { Link2, Sparkles } from "lucide-react";
import type { InputMode } from "../lib/types";

export default function InputModes({ mode, onChange, disabled }: {
  mode: InputMode; onChange: (mode: InputMode) => void; disabled: boolean;
}) {
  return <div className="input-modes" role="group" aria-label="选择生成方式">
    <button type="button" aria-pressed={mode === "guide"} disabled={disabled}
      className={mode === "guide" ? "selected" : ""} onClick={() => onChange("guide")}><Link2 size={15} />粘贴攻略</button>
    <button type="button" aria-pressed={mode === "idea"} disabled={disabled}
      className={mode === "idea" ? "selected" : ""} onClick={() => onChange("idea")}><Sparkles size={15} />一句话规划</button>
  </div>;
}
