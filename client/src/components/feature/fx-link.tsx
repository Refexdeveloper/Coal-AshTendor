import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { playCardFx, scrollToElement, type CardFx } from "./fx";

/** Link that plays a card effect first, then navigates; a #hash target on the same page is scrolled into view. */
export function FxLink({
  href,
  fx,
  className,
  style,
  title,
  children,
}: {
  href: string;
  fx: CardFx;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    // Keyboard activation has no pointer position; the effect then starts from the card's centre.
    const point = event.detail ? { x: event.clientX, y: event.clientY } : undefined;
    const wait = playCardFx(fx, event.currentTarget, point);
    window.setTimeout(() => {
      navigate(href, { preventScrollReset: true });
      const [, hash] = href.split("#");
      if (hash) {
        window.setTimeout(() => {
          const target = document.getElementById(hash);
          if (target) scrollToElement(target);
        }, 120);
      }
    }, wait);
  };
  return (
    <Link to={href} onClick={onClick} className={className} style={style} title={title}>
      {children}
    </Link>
  );
}
