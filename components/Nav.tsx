"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { SessionUser } from "@/lib/types";

export default function Nav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const links = [
    { href: "/assistant", label: "내 부사수" },
    { href: "/timeline", label: "팀 타임라인" },
    ...(user.role === "lead"
      ? [
          { href: "/control", label: "관제뷰" },
          { href: "/settings", label: "연동 설정" },
        ]
      : []),
  ];

  return (
    <header className="topnav">
      <div className="brand">
        팀보드<span className="dot">.</span>
      </div>
      <nav>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname.startsWith(link.href) ? "active" : ""}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      <div className="userchip">
        <span>
          <strong style={{ color: "var(--text)" }}>{user.name}</strong> ·{" "}
          {user.role === "lead" ? "팀장" : "팀원"}
        </span>
        <button className="btn small ghost" onClick={logout}>
          로그아웃
        </button>
      </div>
    </header>
  );
}
