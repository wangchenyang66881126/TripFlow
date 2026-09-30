import type { AnchorHTMLAttributes, MouseEvent } from "react";
import type { NavLink } from "../lib/types";
import { isMobileDevice } from "../lib/navigation";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  link: NavLink;
  onAppNav: (link: NavLink) => void;
};

export default function BaiduLink({ link, onAppNav, ...props }: Props) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // 普通网页链接可复制 / 新窗口打开；仅手机普通点击尝试唤起 App。
    if (isMobileDevice() && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onAppNav(link);
    }
  };
  return <a {...props} href={link.web_uri} target="_blank" rel="noopener noreferrer" onClick={open} />;
}
