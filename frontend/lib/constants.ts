import type { Locale } from "@/stores/appStore";

// Seed data users — Brisbane (en) + Seoul (ko) + Osaka (ja).
// MUST stay in sync with scripts/seed_db.py USERS/POSITIONS (same UUID/name/coords).
function uuid(n: number): string {
  return `${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`;
}

export const SEED_USERS = [
  // Brisbane (en)
  { id: uuid(1),  name: "Alice",  suburb: "South Brisbane",  locale: "en" },
  { id: uuid(2),  name: "Bob",    suburb: "West End",         locale: "en" },
  { id: uuid(3),  name: "Carol",  suburb: "Fortitude Valley", locale: "en" },
  { id: uuid(4),  name: "Dave",   suburb: "New Farm",         locale: "en" },
  { id: uuid(5),  name: "Emma",   suburb: "St Lucia",         locale: "en" },
  { id: uuid(6),  name: "Frank",  suburb: "Woolloongabba",    locale: "en" },
  { id: uuid(7),  name: "Grace",  suburb: "Paddington",       locale: "en" },
  { id: uuid(8),  name: "Dylan",  suburb: "Calamvale",        locale: "en" },
  { id: uuid(9),  name: "Isla",   suburb: "Spring Hill",      locale: "en" },
  { id: uuid(10), name: "Jack",   suburb: "Teneriffe",        locale: "en" },
  { id: uuid(11), name: "Kate",   suburb: "Milton",           locale: "en" },
  { id: uuid(12), name: "Liam",   suburb: "South Bank",       locale: "en" },
  { id: uuid(13), name: "Mia",    suburb: "Bulimba",          locale: "en" },
  { id: uuid(14), name: "Noah",   suburb: "Ascot",            locale: "en" },
  { id: uuid(15), name: "Olivia", suburb: "Newstead",         locale: "en" },
  { id: uuid(16), name: "Peter",  suburb: "Morningside",      locale: "en" },
  { id: uuid(17), name: "Quinn",  suburb: "The Valley",       locale: "en" },
  { id: uuid(18), name: "Ruby",   suburb: "Toowong",          locale: "en" },
  { id: uuid(19), name: "Sam",    suburb: "Annerley",         locale: "en" },
  { id: uuid(20), name: "Tina",   suburb: "Hamilton",         locale: "en" },
  // Korean (ko) — Sunnybank pair + Seoul
  { id: uuid(21), name: "Jiho",     suburb: "Sunnybank",       locale: "ko" },
  { id: uuid(22), name: "Suah",     suburb: "Sunnybank Hills", locale: "ko" },
  { id: uuid(23), name: "김민준",   suburb: "강남",            locale: "ko" },
  { id: uuid(24), name: "이서연",   suburb: "홍대",            locale: "ko" },
  { id: uuid(25), name: "박지훈",   suburb: "성수",            locale: "ko" },
  { id: uuid(26), name: "최수진",   suburb: "명동",            locale: "ko" },
  { id: uuid(27), name: "정하은",   suburb: "이태원",          locale: "ko" },
  { id: uuid(28), name: "강도윤",   suburb: "성수",            locale: "ko" },
  { id: uuid(29), name: "윤서준",   suburb: "홍대",            locale: "ko" },
  { id: uuid(30), name: "임지우",   suburb: "강남",            locale: "ko" },
  // Japanese (ja) — Osaka
  { id: uuid(31), name: "田中太郎", suburb: "難波",            locale: "ja" },
  { id: uuid(32), name: "佐藤花子", suburb: "難波",            locale: "ja" },
  { id: uuid(33), name: "鈴木一郎", suburb: "心斎橋",          locale: "ja" },
  { id: uuid(34), name: "高橋美咲", suburb: "心斎橋",          locale: "ja" },
  { id: uuid(35), name: "渡辺健太", suburb: "梅田",            locale: "ja" },
  { id: uuid(36), name: "伊藤さくら", suburb: "新世界",        locale: "ja" },
  { id: uuid(37), name: "山本翔太", suburb: "梅田",            locale: "ja" },
  { id: uuid(38), name: "中村優子", suburb: "難波",            locale: "ja" },
] as const;

// Default positions — Brisbane suburbs (real coordinates)
export const DEFAULT_POSITIONS: Record<string, { longitude: number; latitude: number }> = {
  [uuid(1)]:  { longitude: 153.0281, latitude: -27.4679 },  // South Brisbane
  [uuid(2)]:  { longitude: 153.0095, latitude: -27.4810 },  // West End
  [uuid(3)]:  { longitude: 153.0360, latitude: -27.4550 },  // Fortitude Valley
  [uuid(4)]:  { longitude: 153.0450, latitude: -27.4670 },  // New Farm
  [uuid(5)]:  { longitude: 152.9990, latitude: -27.4977 },  // St Lucia
  [uuid(6)]:  { longitude: 153.0350, latitude: -27.4900 },  // Woolloongabba
  [uuid(7)]:  { longitude: 152.9990, latitude: -27.4600 },  // Paddington
  [uuid(8)]:  { longitude: 153.0340, latitude: -27.6170 },  // Calamvale
  [uuid(9)]:  { longitude: 153.0270, latitude: -27.4610 },  // Spring Hill
  [uuid(10)]: { longitude: 153.0470, latitude: -27.4560 },  // Teneriffe
  [uuid(11)]: { longitude: 153.0050, latitude: -27.4700 },  // Milton
  [uuid(12)]: { longitude: 153.0230, latitude: -27.4810 },  // South Bank
  [uuid(13)]: { longitude: 153.0570, latitude: -27.4600 },  // Bulimba
  [uuid(14)]: { longitude: 153.0600, latitude: -27.4350 },  // Ascot
  [uuid(15)]: { longitude: 153.0470, latitude: -27.4490 },  // Newstead
  [uuid(16)]: { longitude: 153.0700, latitude: -27.4700 },  // Morningside
  [uuid(17)]: { longitude: 153.0360, latitude: -27.4550 },  // The Valley
  [uuid(18)]: { longitude: 152.9830, latitude: -27.4840 },  // Toowong
  [uuid(19)]: { longitude: 153.0280, latitude: -27.5040 },  // Annerley
  [uuid(20)]: { longitude: 153.0560, latitude: -27.4390 },  // Hamilton
  // Korean (ko)
  [uuid(21)]: { longitude: 153.0590, latitude: -27.5710 },  // Sunnybank
  [uuid(22)]: { longitude: 153.0610, latitude: -27.5750 },  // Sunnybank Hills
  [uuid(23)]: { longitude: 127.0276, latitude: 37.4979 },   // Gangnam
  [uuid(24)]: { longitude: 126.9239, latitude: 37.5563 },   // Hongdae
  [uuid(25)]: { longitude: 127.0557, latitude: 37.5446 },   // Seongsu
  [uuid(26)]: { longitude: 126.9850, latitude: 37.5636 },   // Myeongdong
  [uuid(27)]: { longitude: 126.9947, latitude: 37.5345 },   // Itaewon
  [uuid(28)]: { longitude: 127.0540, latitude: 37.5430 },   // Seongsu (near 25)
  [uuid(29)]: { longitude: 126.9260, latitude: 37.5550 },   // Hongdae (near 24)
  [uuid(30)]: { longitude: 127.0290, latitude: 37.4990 },   // Gangnam (near 23)
  // Japanese (ja)
  [uuid(31)]: { longitude: 135.5023, latitude: 34.6659 },   // Namba
  [uuid(32)]: { longitude: 135.5030, latitude: 34.6670 },   // Namba (near 31)
  [uuid(33)]: { longitude: 135.5010, latitude: 34.6723 },   // Shinsaibashi
  [uuid(34)]: { longitude: 135.5020, latitude: 34.6730 },   // Shinsaibashi (near 33)
  [uuid(35)]: { longitude: 135.4983, latitude: 34.7055 },   // Umeda
  [uuid(36)]: { longitude: 135.5063, latitude: 34.6524 },   // Shinsekai
  [uuid(37)]: { longitude: 135.4990, latitude: 34.7045 },   // Umeda (near 35)
  [uuid(38)]: { longitude: 135.5035, latitude: 34.6650 },   // Namba (near 31)
};

// Map defaults — initial center per UI locale (--lang / NEXT_PUBLIC_DEFAULT_LOCALE).
// Only the initial map focus; the user can pan/zoom freely afterwards.
export const MAP_CENTER_BY_LOCALE: Record<Locale, [number, number]> = {
  en: [153.0281, -27.4679], // Brisbane City Hall
  ko: [126.9990, 37.5400],  // Seoul (between Gangnam / Hongdae / Myeongdong)
  ja: [135.5010, 34.6800],  // Osaka (between Namba / Umeda / Shinsaibashi)
};
export const MAP_ZOOM = 14; // Slightly zoomed out to show more suburbs

// Matching defaults
export const DEFAULT_RADIUS_M = 5000;
export const DEFAULT_MAX_TURNS = 30;

// WebSocket URL
export function getWsBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const directUrl = process.env.NEXT_PUBLIC_WS_DIRECT_URL;
  if (directUrl) return directUrl;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/gateway`;
}
