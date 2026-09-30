import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import TravelHome from "./TravelHome";
import type { InputMode } from "../lib/types";
import { PRESET_TEXT } from "../lib/preset";

afterEach(cleanup);

it("演示固定完整分享文案，不能输入或切换模式，按钮仍可打开方案", () => {
  const onChange = vi.fn();
  const generate = vi.fn();
  render(<TravelHome demoMode mode="guide" onModeChange={vi.fn()} link={PRESET_TEXT}
    onLinkChange={onChange} busy={false} error="" onGenerate={generate} onDemo={vi.fn()} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(input.value).toBe(PRESET_TEXT);
  expect(input.readOnly).toBe(true);
  expect(input.disabled).toBe(false);
  fireEvent.change(input, { target: { value: "换成成都" } });
  expect(onChange).not.toHaveBeenCalled();
  expect(input.value).toBe(PRESET_TEXT);
  expect(screen.queryByRole("button", { name: "一句话规划" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "生成演示行程" }));
  expect(generate).toHaveBeenCalledOnce();
});

describe("双入口生成", () => {
  it("切换想法模式保留输入，示例不会自动提交", () => {
    const generate = vi.fn();
    const demo = vi.fn();
    function Harness() {
      const [mode, setMode] = useState<InputMode>("guide");
      const [link, setLink] = useState("重庆玩两天");
      return <TravelHome mode={mode} onModeChange={setMode} link={link} onLinkChange={setLink}
        busy={false} error="" onGenerate={generate} onDemo={demo} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "一句话规划" }));
    expect((screen.getByRole("textbox", { name: "旅行想法" }) as HTMLTextAreaElement).value).toBe("重庆玩两天");
    fireEvent.click(screen.getByRole("button", { name: /试试「重庆/ }));
    expect(demo).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成旅行方案" }));
    expect(generate).toHaveBeenCalledOnce();
  });

  it("生成期间阻止修改入口和重复提交", () => {
    render(<TravelHome mode="idea" onModeChange={vi.fn()} link="重庆" onLinkChange={vi.fn()}
      busy error="" onGenerate={vi.fn()} onDemo={vi.fn()} />);
    expect((screen.getByRole("button", { name: "生成旅行方案" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "粘贴攻略" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
