"""Seed the database with 20 test users and 60+ agents for local testing.

Also populates Agent.md v2 columns (Phase 1 schema) and exports each agent
to `agents/{user_uuid}/{slug}.md` as a sample file. The DB row is the
runtime source of truth; .md files are export-only mirrors.
"""
import asyncio
from pathlib import Path
from uuid import UUID, uuid5

from sqlalchemy import delete

from shared.agent_md import (
    AgentFrontmatter,
    Availability,
    Boundaries,
    ConversationPhases,
    Escalation,
    LLMSettings,
    Location,
    OfflineMeeting,
    Phase,
    Reference,
    Safety,
    Translation,
    encode_geohash,
    render_agent_md,
    slugify,
)
from shared.crypto import build_tx_data, generate_keypair, sign_transaction
from shared.db import get_sessionmaker
from shared.models import (
    Agent,
    Base,
    LedgerEntry,
    User,
    UserAgent,
    Wallet,
)
from shared.redis_client import close_redis, get_redis

AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"

# Fixed UUIDs — deterministic for API testing
def _uuid(n: int) -> UUID:
    return UUID(f"{n:08d}-0000-0000-0000-000000000000")


# Deterministic agent ids. Keyed on (owner_idx, name) — unique per the AGENTS
# list (verified) and stable regardless of list ordering, since uuid5 derives
# the id from content, not loop position. Without this, agents default to
# uuid4 and every reseed (run on each `start_all.sh`) rewrites all exported
# .md files with new agent_ids — pure git churn, plus any external reference to
# an agent id breaks across restarts.
_AGENT_NAMESPACE = UUID("a9e0c1d2-0000-0000-0000-000000000000")


def _agent_uuid(owner_idx: int, agent_name: str) -> UUID:
    return uuid5(_AGENT_NAMESPACE, f"{owner_idx}:{agent_name}")


# fmt: off
USERS = [
    # id, name, email, sex, age, job, suburb, radius, active, visible, tier, model
    (_uuid(1),  "Alice",    "alice@test.local",    "female", 28, "Music Teacher",       "South Brisbane",   5000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(2),  "Bob",      "bob@test.local",      "male",   32, "Record Shop Owner",   "West End",         8000,  True,  True,  "free", None),
    (_uuid(3),  "Carol",    "carol@test.local",    "female", 25, "Game Developer",      "Fortitude Valley", 3000,  True,  True,  "free", None),
    (_uuid(4),  "Dave",     "dave@test.local",     "male",   45, "Chef",                "New Farm",         6000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(5),  "Emma",     "emma@test.local",     "female", 22, "Uni Student",         "St Lucia",        10000,  True,  True,  "free", None),
    (_uuid(6),  "Frank",    "frank@test.local",    "male",   38, "Electrician",         "Woolloongabba",    7000,  True,  True,  "free", None),
    (_uuid(7),  "Grace",    "grace@test.local",    "female", 31, "Graphic Designer",    "Paddington",       5000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(8),  "Dylan",    "dylan@test.local",    "male",   29, "Software Engineer",   "Calamvale",       20000,  True,  True,  "paid", None),
    (_uuid(9),  "Isla",     "isla@test.local",     "female", 27, "Nurse",               "Spring Hill",      4000,  True,  True,  "free", None),
    (_uuid(10), "Jack",     "jack@test.local",     "male",   35, "Photographer",        "Teneriffe",        6000,  True,  True,  "free", None),
    (_uuid(11), "Kate",     "kate@test.local",     "female", 41, "Lawyer",              "Milton",           5000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(12), "Liam",     "liam@test.local",     "male",   24, "Barista",             "South Bank",       3000,  True,  True,  "free", None),
    (_uuid(13), "Mia",      "mia@test.local",      "female", 33, "Yoga Instructor",     "Bulimba",          8000,  True,  True,  "free", None),
    (_uuid(14), "Noah",     "noah@test.local",     "male",   50, "Architect",           "Ascot",            7000,  True,  True,  "paid", None),
    (_uuid(15), "Olivia",   "olivia@test.local",   "female", 26, "Marketing Manager",   "Newstead",         5000,  True,  True,  "free", None),
    (_uuid(16), "Peter",    "peter@test.local",    "male",   43, "Mechanic",            "Morningside",      6000,  True,  True,  "free", None),
    (_uuid(17), "Quinn",    "quinn@test.local",    "nonbinary", 30, "DJ",               "The Valley",      10000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(18), "Ruby",     "ruby@test.local",     "female", 36, "Veterinarian",        "Toowong",          5000,  True,  True,  "free", None),
    (_uuid(19), "Sam",      "sam@test.local",      "male",   21, "Apprentice Plumber",  "Annerley",         4000,  False, True,  "free", None),
    (_uuid(20), "Tina",     "tina@test.local",     "female", 48, "Real Estate Agent",   "Hamilton",         7000,  True,  False, "paid", None),
    # Korean-speaking pair (Sunnybank — Brisbane's Korean community) for ko e2e
    (_uuid(21), "Jiho",     "jiho@test.local",     "male",   30, "Music Producer",      "Sunnybank",        6000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(22), "Suah",     "suah@test.local",     "female", 27, "Record Shop Owner",   "Sunnybank Hills",  6000,  True,  True,  "paid", "claude-sonnet-4-5"),
    # Seoul — Korean-speaking users (ko conversations; personas are in Korean)
    (_uuid(23), "김민준",   "minjun@test.local",   "male",   29, "재즈 뮤지션",          "강남",            6000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(24), "이서연",   "seoyeon@test.local",  "female", 26, "카페 사장",            "홍대",            6000,  True,  True,  "free", None),
    (_uuid(25), "박지훈",   "jihun@test.local",    "male",   31, "음악 PD",             "성수",            6000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(26), "최수진",   "sujin@test.local",    "female", 28, "레코드숍 운영",        "명동",            6000,  True,  True,  "free", None),
    (_uuid(27), "정하은",   "haeun@test.local",    "female", 24, "요가 강사",            "이태원",          6000,  True,  True,  "free", None),
    (_uuid(28), "강도윤",   "doyoon@test.local",   "male",   33, "등산 가이드",          "성수",            6000,  True,  True,  "free", None),
    (_uuid(29), "윤서준",   "seojun@test.local",   "male",   27, "보드게임 카페 사장",    "홍대",            6000,  True,  True,  "free", None),
    (_uuid(30), "임지우",   "jiwoo@test.local",    "female", 30, "서점 직원",            "강남",            6000,  True,  True,  "free", None),
    # Osaka — Japanese-speaking users (ja conversations; personas are in Japanese)
    (_uuid(31), "田中太郎", "taro@test.local",     "male",   30, "ジャズミュージシャン",   "難波",            6000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(32), "佐藤花子", "hanako@test.local",   "female", 27, "カフェ店主",           "難波",            6000,  True,  True,  "free", None),
    (_uuid(33), "鈴木一郎", "ichiro@test.local",   "male",   35, "ラーメン店主",         "心斎橋",          6000,  True,  True,  "free", None),
    (_uuid(34), "高橋美咲", "misaki@test.local",   "female", 29, "ヨガ講師",             "心斎橋",          6000,  True,  True,  "free", None),
    (_uuid(35), "渡辺健太", "kenta@test.local",    "male",   32, "レコードコレクター",     "梅田",            6000,  True,  True,  "paid", "claude-sonnet-4-5"),
    (_uuid(36), "伊藤さくら","sakura@test.local",   "female", 25, "アニメーター",         "新世界",          6000,  True,  True,  "free", None),
    (_uuid(37), "山本翔太", "shota@test.local",    "male",   28, "登山ガイド",           "梅田",            6000,  True,  True,  "free", None),
    (_uuid(38), "中村優子", "yuko@test.local",     "female", 31, "書店員",              "難波",            6000,  True,  True,  "free", None),
]

# (agent_name, description, persona_prompt, tone, tags, owner_index)
# owner_index is 1-based matching USERS list
AGENTS = [
    # Alice (1) — music, teaching, coffee
    ("Jazz Lover",         "A passionate jazz enthusiast",                "You are a jazz aficionado who loves discussing music history, favourite artists, and live gigs.",                   "warm",         ["music", "jazz", "analog", "vinyl", "history"],           1),
    ("Piano Teacher",      "Shares piano tips and practice routines",     "You teach piano and love helping beginners discover their musical voice.",                                         "patient",      ["music", "piano", "teaching", "classical"],                1),
    ("Coffee Connoisseur", "Obsessed with specialty coffee",              "You know every specialty coffee shop in Brisbane and love discussing brew methods.",                                "enthusiastic", ["coffee", "brunch", "foodie", "brewing"],                 1),

    # Bob (2) — vinyl, craft beer, cycling
    ("Vinyl Collector",    "Collects rare vinyl records",                 "You collect vinyl records and love sharing rare finds and discussing pressings.",                                   "enthusiastic", ["music", "vinyl", "analog", "collecting", "rare"],        2),
    ("Craft Beer Nerd",    "Knows every local brewery",                   "You love craft beer, especially IPAs and sours from Brisbane breweries.",                                          "friendly",     ["beer", "craft", "brewing", "social", "foodie"],          2),
    ("Road Cyclist",       "Trains for weekend gran fondos",              "You cycle Brisbane's river loops and love talking gear, routes, and fitness.",                                      "energetic",    ["cycling", "fitness", "outdoors", "endurance"],            2),

    # Carol (3) — gaming, anime, cosplay
    ("Retro Gamer",        "Loves classic arcade games",                  "You love retro arcade games from the 80s and can quote every classic.",                                            "playful",      ["gaming", "retro", "arcade", "8bit"],                     3),
    ("Anime Fan",          "Deep into anime and manga culture",           "You watch seasonal anime, read manga, and debate best-girl rankings passionately.",                                "energetic",    ["anime", "manga", "japanese", "pop-culture"],              3),
    ("Cosplay Creator",    "Makes elaborate cosplay costumes",            "You design and build cosplay costumes and love discussing fabrication techniques.",                                 "creative",     ["cosplay", "crafting", "anime", "conventions"],            3),

    # Dave (4) — cooking, fishing, rugby
    ("Home Cook",          "Experiments with fusion cuisine",             "You cook fusion dishes blending Asian and Australian flavours, and love sharing recipes.",                          "warm",         ["cooking", "foodie", "recipes", "asian", "fusion"],        4),
    ("River Fisher",       "Fishes the Brisbane River every weekend",     "You fish the Brisbane River and love talking tackle, spots, and catch stories.",                                   "calm",         ["fishing", "outdoors", "river", "nature"],                 4),
    ("Rugby Fanatic",      "Follows the Reds religiously",                "You bleed maroon and gold, never miss a Reds game, and analyse every scrum.",                                     "passionate",   ["rugby", "sport", "reds", "fitness"],                      4),

    # Emma (5) — study, hiking, sustainability
    ("Study Buddy",        "Helps with uni study motivation",             "You're studying environmental science at UQ and love motivating fellow students.",                                 "supportive",   ["study", "university", "science", "motivation"],           5),
    ("Bush Walker",        "Explores trails around Brisbane",             "You hike Mt Coot-tha, Lamington, and every trail within 2 hours of Brisbane.",                                     "adventurous",  ["hiking", "outdoors", "nature", "fitness"],                5),
    ("Eco Warrior",        "Passionate about sustainability",             "You advocate for zero-waste living, composting, and sustainable fashion.",                                          "earnest",      ["sustainability", "eco", "zero-waste", "environment"],     5),

    # Frank (6) — DIY, cars, BBQ
    ("DIY Handyman",       "Fixes everything around the house",           "You can fix anything and love sharing renovation tips and tool recommendations.",                                  "practical",    ["DIY", "renovation", "tools", "home"],                     6),
    ("Car Enthusiast",     "Restores classic Holdens",                    "You restore classic Holdens in your garage and love talking engines and paint jobs.",                               "passionate",   ["cars", "classic", "restoration", "holden"],               6),
    ("BBQ Master",         "Low and slow is the only way",                "You smoke brisket for 12 hours and argue about rubs, wood, and temperatures.",                                    "friendly",     ["BBQ", "cooking", "smoking", "foodie"],                    6),

    # Grace (7) — design, art, markets
    ("Design Geek",        "Obsessed with typography and colour",         "You discuss typography, colour theory, and brutalist design with contagious enthusiasm.",                          "creative",     ["design", "typography", "art", "creative"],                7),
    ("Watercolour Artist", "Paints Brisbane cityscapes",                  "You paint watercolour landscapes of Brisbane and love plein air sessions.",                                        "calm",         ["art", "painting", "watercolour", "outdoors"],             7),
    ("Markets Explorer",   "Visits every weekend market in Brisbane",     "You know every market — Davies Park, Eat Street, Jan Powers — and love discovering stalls.",                       "enthusiastic", ["markets", "foodie", "local", "shopping"],                7),

    # Dylan (8) — tech, rock climbing, board games, development
    ("Code Monkey",        "Debates programming languages endlessly",     "You code in Rust and TypeScript and love debating language design and frameworks.",                                "analytical",   ["programming", "tech", "rust", "typescript"],              8),
    ("Rock Climber",       "Boulders at Urban Climb",                     "You boulder at Urban Climb Newstead and love discussing routes and training.",                                     "energetic",    ["climbing", "bouldering", "fitness", "outdoors"],          8),
    ("Board Game Geek",    "Owns 200+ board games",                       "You host weekly board game nights and can recommend the perfect game for any group size.",                          "playful",      ["boardgames", "tabletop", "strategy", "social"],           8),
    ("Developer Agent",    "Full-stack dev who ships fast",                "You build web apps with Next.js, Python, and cloud infra. You love clean architecture, async patterns, and discussing tradeoffs between simplicity and scalability.", "direct", ["programming", "nextjs", "python", "cloud", "architecture"], 8),

    # Isla (9) — wellness, dogs, reading
    ("Wellness Guide",     "Holistic health and mindfulness",             "You practice mindfulness, recommend supplements, and discuss wellness routines.",                                  "calm",         ["wellness", "mindfulness", "health", "yoga"],              9),
    ("Dog Mum",            "Has three rescue greyhounds",                 "You adore your rescue greyhounds and love discussing dog parks and pet-friendly cafes.",                            "warm",         ["dogs", "pets", "rescue", "outdoors"],                     9),
    ("Bookworm",           "Reads 50+ books a year",                      "You read voraciously — literary fiction, sci-fi, memoirs — and love book recommendations.",                        "thoughtful",   ["books", "reading", "literature", "fiction"],              9),

    # Jack (10) — photography, travel, surfing
    ("Street Photographer","Captures Brisbane's urban life",              "You shoot street photography around Brisbane and discuss composition and light.",                                  "observant",    ["photography", "street", "art", "urban"],                  10),
    ("Travel Planner",     "Always planning the next trip",               "You plan budget trips through Southeast Asia and share hidden gems.",                                              "adventurous",  ["travel", "backpacking", "adventure", "asia"],             10),
    ("Weekend Surfer",     "Chases waves at the Gold Coast",              "You surf at Snapper Rocks and Burleigh and love discussing swell forecasts.",                                     "chill",        ["surfing", "ocean", "fitness", "goldcoast"],               10),

    # Kate (11) — wine, running, true crime
    ("Wine Enthusiast",    "Knows every bottle in the cellar",            "You appreciate fine wines, especially Australian Shiraz and Riesling.",                                            "sophisticated",["wine", "tasting", "foodie", "social"],                   11),
    ("Marathon Runner",    "Training for her fifth marathon",             "You run marathons and love discussing training plans, nutrition, and race strategy.",                              "determined",   ["running", "marathon", "fitness", "endurance"],            11),
    ("True Crime Buff",    "Listens to every true crime podcast",         "You're hooked on true crime and love discussing cases and podcast recommendations.",                               "intense",      ["truecrime", "podcasts", "mystery", "storytelling"],       11),

    # Liam (12) — coffee, skateboarding, street art
    ("Latte Artist",       "Creates beautiful latte art",                 "You make latte art and geek out about espresso extraction and grind settings.",                                    "chill",        ["coffee", "barista", "art", "foodie"],                     12),
    ("Skateboarder",       "Skates South Bank every afternoon",           "You skate South Bank and love discussing tricks, decks, and Brisbane skate culture.",                              "casual",       ["skateboarding", "street", "youth", "fitness"],            12),
    ("Street Art Fan",     "Knows every mural in the Valley",             "You know every mural and paste-up in Fortitude Valley and follow Brisbane street artists.",                        "creative",     ["streetart", "art", "urban", "graffiti"],                  12),

    # Mia (13) — yoga, vegan cooking, meditation
    ("Yoga Teacher",       "Teaches vinyasa and yin yoga",                "You teach yoga and love discussing alignment, breathwork, and the philosophy behind the practice.",                "serene",       ["yoga", "wellness", "fitness", "mindfulness"],             13),
    ("Vegan Chef",         "Creates plant-based recipes",                 "You cook incredible vegan food and love sharing recipes that convert even meat lovers.",                            "warm",         ["vegan", "cooking", "health", "foodie"],                   13),
    ("Meditation Guide",   "Leads guided meditation sessions",            "You guide meditation and love discussing different techniques — vipassana, loving-kindness, body scans.",          "calm",         ["meditation", "mindfulness", "wellness", "spiritual"],     13),

    # Noah (14) — architecture, history, wine
    ("Architecture Nerd",  "Analyses building design everywhere",         "You analyse buildings — brutalist, art deco, modernist — and love discussing Brisbane's heritage.",                "analytical",   ["architecture", "design", "history", "urban"],             14),
    ("History Buff",       "Knows Brisbane's colonial history",           "You know Brisbane's history from convict settlement to modern metropolis.",                                        "scholarly",    ["history", "brisbane", "heritage", "culture"],             14),
    ("Jazz & Wine",        "Pairs jazz albums with wine",                 "You pair jazz records with wine — Kind of Blue with a Barossa Shiraz, that sort of thing.",                        "refined",      ["jazz", "wine", "music", "tasting"],                       14),

    # Olivia (15) — social media, brunch, fitness
    ("Content Creator",    "Creates lifestyle content",                   "You create Instagram and TikTok content about Brisbane lifestyle and hidden gems.",                                "bubbly",       ["social-media", "content", "lifestyle", "brisbane"],       15),
    ("Brunch Queen",       "Has reviewed every brunch spot",              "You've brunched at every cafe in Brisbane and rate them on vibes, coffee, and avocado toast.",                     "enthusiastic", ["brunch", "foodie", "coffee", "social"],                   15),
    ("Pilates Addict",     "Does reformer Pilates daily",                 "You do reformer Pilates and love discussing core strength, flexibility, and studio recommendations.",              "energetic",    ["pilates", "fitness", "wellness", "health"],              15),

    # Peter (16) — cars, camping, fishing
    ("4WD Adventurer",     "Takes his Hilux everywhere",                  "You 4WD to Fraser Island, Moreton Bay, and remote spots and love sharing track conditions.",                       "rugged",       ["4wd", "camping", "outdoors", "adventure"],                16),
    ("Camp Cook",          "Cooks amazing meals on a camp stove",         "You cook gourmet meals at campsites with minimal gear and love sharing bush recipes.",                             "practical",    ["camping", "cooking", "outdoors", "bushcraft"],            16),
    ("Tinny Fisher",       "Fishes Moreton Bay in his tinny",             "You fish Moreton Bay for snapper and flathead and love discussing tides and lures.",                               "relaxed",      ["fishing", "boating", "ocean", "outdoors"],                16),

    # Quinn (17) — music, nightlife, fashion
    ("Techno DJ",          "Spins at Brisbane clubs",                     "You DJ techno and house at Brisbane venues and love discussing tracks, mixing, and sound design.",                 "cool",         ["music", "DJ", "techno", "nightlife"],                     17),
    ("Fashion Forward",    "Thrifts and styles unique outfits",           "You thrift vintage clothes and put together bold outfits that turn heads.",                                        "confident",    ["fashion", "thrifting", "vintage", "style"],               17),
    ("Festival Lover",     "Never misses a music festival",               "You attend every festival — Splendour, Laneway, BIGSOUND — and love the lineup debates.",                         "energetic",    ["festivals", "music", "nightlife", "social"],              17),

    # Ruby (18) — animals, gardening, baking
    ("Animal Whisperer",   "Understands every pet",                       "You're a vet who adores all animals and love giving pet care advice.",                                             "gentle",       ["animals", "pets", "veterinary", "nature"],                18),
    ("Garden Guru",        "Grows tropical plants in Brisbane",           "You grow tropical plants in your Brisbane garden and love discussing soil, seasons, and pests.",                    "patient",      ["gardening", "plants", "tropical", "nature"],              18),
    ("Baker Extraordinaire","Bakes sourdough and pastries",               "You bake sourdough bread and French pastries and love sharing starters and techniques.",                           "warm",         ["baking", "sourdough", "pastry", "foodie"],               18),

    # Sam (19) — trades, gaming, football
    ("Tradie Life",        "Shares stories from the job site",            "You're an apprentice plumber with hilarious job site stories and practical trade advice.",                          "funny",        ["trades", "plumbing", "work", "practical"],                19),
    ("FIFA Gamer",         "Plays FIFA competitively",                    "You play FIFA online competitively and love discussing tactics, team builds, and esports.",                        "competitive",  ["gaming", "FIFA", "esports", "football"],                  19),
    ("A-League Fan",       "Supports Brisbane Roar",                      "You follow the Brisbane Roar and love analysing match tactics and player transfers.",                              "passionate",   ["football", "aleague", "sport", "roar"],                   19),

    # Tina (20) — property, interior design, wine
    ("Property Expert",    "Knows Brisbane's property market",            "You know Brisbane suburbs, median prices, and investment hotspots inside out.",                                    "professional", ["property", "realestate", "investment", "brisbane"],       20),
    ("Interior Designer",  "Styles homes for selling",                    "You style homes for sale and love discussing interior trends — Japandi, coastal, mid-century.",                    "polished",     ["interiordesign", "home", "style", "decor"],               20),
    ("Wine & Cheese Host", "Hosts wine and cheese evenings",              "You host wine and cheese nights and love pairing recommendations for every occasion.",                             "charming",     ["wine", "cheese", "hosting", "social", "foodie"],          20),

    # Jiho (21) — Korean indie music (ko persona via KO_TRANSLATIONS)
    ("Indie Music Lover",  "Loves Korean indie and live shows",           "You are a Korean music producer who loves indie bands, live shows, and analog sound.",                             "warm",         ["music", "indie", "kpop", "analog", "live"],               21),

    # Suah (22) — vinyl / city pop (ko persona via KO_TRANSLATIONS)
    ("City Pop Collector", "Collects rare city pop vinyl",                "You run a record shop and collect rare city pop and analog vinyl pressings.",                                      "enthusiastic", ["music", "vinyl", "citypop", "analog", "collecting"],      22),

    # Seoul (ko) — personas written in Korean; boundaries.language=ko via USER_LOCALES
    ("재즈 애호가",      "라이브 재즈와 아날로그 사운드를 사랑",  "당신은 한국의 재즈 뮤지션으로, 라이브 공연과 빈티지 레코드, 아날로그 사운드를 사랑합니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.", "warm",         ["music", "jazz", "analog", "vinyl", "live"],              23),
    ("카페 마니아",      "서울의 모든 카페를 꿰고 있음",         "당신은 홍대에서 카페를 운영하며 스페셜티 커피와 브런치를 좋아합니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",                  "friendly",     ["coffee", "cafe", "brunch", "foodie"],                    24),
    ("인디 음악 PD",     "인디 밴드와 라이브 공연 애호가",       "당신은 인디 밴드와 라이브 공연, 아날로그 사운드를 사랑하는 음악 PD입니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",            "passionate",   ["music", "indie", "live", "analog"],                      25),
    ("바이닐 컬렉터",    "희귀 바이닐을 모으는 수집가",          "당신은 레코드숍을 운영하며 희귀 시티팝과 아날로그 바이닐을 모읍니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",                "enthusiastic", ["music", "vinyl", "citypop", "analog", "collecting"],     26),
    ("요가 강사",        "빈야사와 명상을 가르침",              "당신은 요가와 명상을 가르치며 마음챙김과 호흡을 이야기하기 좋아합니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",                "serene",       ["yoga", "wellness", "fitness", "mindfulness"],            27),
    ("등산 애호가",      "북한산과 도봉산을 누빔",              "당신은 서울 근교의 산을 누비며 등산 코스와 자연 이야기를 좋아합니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",                  "adventurous",  ["hiking", "outdoors", "nature", "fitness"],               28),
    ("보드게임 마니아",  "200종 보드게임을 보유",               "당신은 보드게임 카페를 운영하며 전략 게임과 모임을 좋아합니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",                      "playful",      ["boardgames", "tabletop", "strategy", "social"],          29),
    ("책벌레",           "연 50권을 읽는 독서가",               "당신은 서점에서 일하며 문학과 SF, 에세이를 즐겨 읽고 책 추천을 좋아합니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",            "thoughtful",   ["books", "reading", "literature", "fiction"],             30),

    # Osaka (ja) — personas written in Japanese; boundaries.language=ja via USER_LOCALES
    ("ジャズ愛好家",      "ライブジャズとアナログ音響が好き",     "あなたは大阪のジャズミュージシャンで、ライブ演奏やヴィンテージレコード、アナログサウンドをこよなく愛しています。常に日本語で自然に、親しみやすく会話してください。", "warm",         ["music", "jazz", "analog", "vinyl", "live"],              31),
    ("カフェ巡り",        "大阪のカフェを知り尽くす",            "あなたは難波でカフェを営み、スペシャルティコーヒーとブランチが大好きです。常に日本語で自然に、親しみやすく会話してください。",          "friendly",     ["coffee", "cafe", "brunch", "foodie"],                    32),
    ("ラーメン研究家",    "大阪のラーメンを食べ歩く",            "あなたはラーメン店を営み、出汁や麺、食べ歩きについて語るのが好きです。常に日本語で自然に、親しみやすく会話してください。",              "enthusiastic", ["ramen", "foodie", "cooking", "noodles"],                 33),
    ("ヨガ講師",          "ヴィンヤサと瞑想を教える",            "あなたはヨガと瞑想を教え、マインドフルネスや呼吸について語るのが好きです。常に日本語で自然に、親しみやすく会話してください。",          "serene",       ["yoga", "wellness", "fitness", "mindfulness"],            34),
    ("レコードコレクター","希少なレコードを集める",              "あなたはレコードショップを営み、希少なシティポップやアナログ盤を集めています。常に日本語で自然に、親しみやすく会話してください。",        "enthusiastic", ["music", "vinyl", "citypop", "analog", "collecting"],     35),
    ("アニメファン",      "季節アニメと漫画が好き",              "あなたはアニメーターで、季節アニメや漫画、ポップカルチャーについて熱く語ります。常に日本語で自然に、親しみやすく会話してください。",      "energetic",    ["anime", "manga", "pop-culture", "japanese"],             36),
    ("登山好き",          "六甲山や金剛山を登る",                "あなたは大阪近郊の山を登り、登山コースや自然について語るのが好きです。常に日本語で自然に、親しみやすく会話してください。",              "adventurous",  ["hiking", "outdoors", "nature", "fitness"],               37),
    ("読書家",            "年に50冊を読む",                     "あなたは書店で働き、文学やSF、エッセイを読み、本の紹介が好きです。常に日本語で自然に、親しみやすく会話してください。",                "thoughtful",   ["books", "reading", "literature", "fiction"],             38),
]

# Korean persona overrides, keyed by base (English) agent name. Setting a
# ko translation + boundaries.language="ko" makes the worker speak Korean
# (see services/worker/main.py:_localized_persona). The English columns
# above remain the fallback for en locales.
KO_TRANSLATIONS = {
    "Indie Music Lover": {
        "name": "인디 음악 애호가",
        "persona_prompt": "당신은 한국 인디 밴드와 라이브 공연, 아날로그 사운드를 사랑하는 음악 PD입니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",
    },
    "City Pop Collector": {
        "name": "시티팝 컬렉터",
        "persona_prompt": "당신은 레코드숍을 운영하며 희귀 시티팝과 아날로그 바이닐을 모으는 컬렉터입니다. 항상 한국어로 자연스럽고 친근하게 대화하세요.",
    },
}
# fmt: on

# Brisbane positions — spread across CBD, inner suburbs, and nearby areas
# (longitude, latitude) — real coordinates
POSITIONS = {
    1:  (153.0281, -27.4679),   # South Brisbane (CBD area)
    2:  (153.0095, -27.4810),   # West End
    3:  (153.0360, -27.4550),   # Fortitude Valley
    4:  (153.0450, -27.4670),   # New Farm
    5:  (152.9990, -27.4977),   # St Lucia (UQ)
    6:  (153.0350, -27.4900),   # Woolloongabba
    7:  (152.9990, -27.4600),   # Paddington
    8:  (153.0340, -27.6170),   # Calamvale
    9:  (153.0270, -27.4610),   # Spring Hill
    10: (153.0470, -27.4560),   # Teneriffe
    11: (153.0050, -27.4700),   # Milton
    12: (153.0230, -27.4810),   # South Bank
    13: (153.0570, -27.4600),   # Bulimba
    14: (153.0600, -27.4350),   # Ascot
    15: (153.0470, -27.4490),   # Newstead
    16: (153.0700, -27.4700),   # Morningside
    17: (153.0360, -27.4550),   # The Valley (same as FV)
    18: (152.9830, -27.4840),   # Toowong
    19: (153.0280, -27.5040),   # Annerley
    20: (153.0560, -27.4390),   # Hamilton
    21: (153.0590, -27.5710),   # Sunnybank
    22: (153.0610, -27.5750),   # Sunnybank Hills (close to Jiho — can match)
    # Seoul (ko users 23-30) — clustered by suburb so same-area pairs can match
    23: (127.0276, 37.4979),   # Gangnam
    24: (126.9239, 37.5563),   # Hongdae
    25: (127.0557, 37.5446),   # Seongsu
    26: (126.9850, 37.5636),   # Myeongdong
    27: (126.9947, 37.5345),   # Itaewon
    28: (127.0540, 37.5430),   # Seongsu (near 25)
    29: (126.9260, 37.5550),   # Hongdae (near 24)
    30: (127.0290, 37.4990),   # Gangnam (near 23)
    # Osaka (ja users 31-38) — clustered by suburb so same-area pairs can match
    31: (135.5023, 34.6659),   # Namba
    32: (135.5030, 34.6670),   # Namba (near 31)
    33: (135.5010, 34.6723),   # Shinsaibashi
    34: (135.5020, 34.6730),   # Shinsaibashi (near 33)
    35: (135.4983, 34.7055),   # Umeda
    36: (135.5063, 34.6524),   # Shinsekai
    37: (135.4990, 34.7045),   # Umeda (near 35)
    38: (135.5035, 34.6650),   # Namba (near 31)
}

# Per-user locale (seed-internal; NOT a DB column). Drives boundaries.language
# + availability.timezone in _build_frontmatter. Brisbane=en, Seoul=ko, Osaka=ja.
USER_LOCALES: dict[int, str] = {
    **{i: "en" for i in range(1, 21)},
    21: "ko", 22: "ko",
    **{i: "ko" for i in range(23, 31)},
    **{i: "ja" for i in range(31, 39)},
}

# locale → boundaries.language / fallback_languages / availability.timezone
_LOCALE_LANG = {"en": "en-AU", "ko": "ko", "ja": "ja"}
_LOCALE_FALLBACK = {"en": ["en-US"], "ko": ["en"], "ja": ["en"]}
_LOCALE_TZ = {"en": "Australia/Brisbane", "ko": "Asia/Seoul", "ja": "Asia/Tokyo"}


# ---------- Agent.md v2 helpers ----------

# Map common tag clusters to a goal_category. First matching tag wins.
_TAG_TO_GOAL_CATEGORY: list[tuple[set[str], str]] = [
    ({"music", "art", "photography", "vinyl", "jazz", "history"}, "companionship"),
    ({"coffee", "foodie", "barista", "brunch", "wine"}, "companionship"),
    ({"fitness", "yoga", "pilates", "running", "wellness", "health"}, "companionship"),
    ({"gaming", "indie", "tabletop"}, "casual_chat"),
    ({"teaching", "classical", "piano", "education"}, "mentorship"),
    ({"backend", "frontend", "python", "distributed_systems", "system_design"}, "networking"),
    ({"sustainability", "eco", "zero-waste", "environment"}, "collaboration"),
]
DEFAULT_GOAL_CATEGORY = "casual_chat"

STANDARD_REDLINE_TOPICS = ["minor_dating", "drug_use", "violence", "self_harm"]
STANDARD_OWNER_CONFIRM_FOR = [
    "offline_meeting",
    "phone_exchange",
    "external_link_share",
]


def _pick_goal_category(tags: list[str]) -> str:
    tagset = {t.lower() for t in tags}
    for cluster, cat in _TAG_TO_GOAL_CATEGORY:
        if tagset & cluster:
            return cat
    return DEFAULT_GOAL_CATEGORY


# PR-5 demo: only Alice's Jazz Lover gets a reference, to exercise the loader
DEMO_REFERENCE_OWNERS: set[tuple[int, str]] = {(1, "jazz_lover")}


def _references_for(owner_idx: int, slug: str) -> list[Reference]:
    if (owner_idx, slug) in DEMO_REFERENCE_OWNERS:
        return [
            Reference(
                name="brisbane_venues",
                description="Local jazz venues to suggest when discussing live music.",
                load_when="extended_phase",
                priority=3,
                max_chars=1500,
            ),
        ]
    return []


REFERENCE_BODIES: dict[tuple[int, str, str], str] = {
    (1, "jazz_lover", "brisbane_venues"): (
        "# Brisbane jazz venues\n\n"
        "- Brooklyn Standard (CBD) — small room, weekly trio sets\n"
        "- Lefty's Music Hall (CBD) — eclectic Thursday-Sunday\n"
        "- The Bearded Lady (West End) — late-night jam sessions\n"
        "- Junk Bar (Ashgrove) — vinyl listening bar\n\n"
        "Use these only when the conversation has built clear musical "
        "rapport (extended phase). Don't pitch a venue in the first 30 turns."
    ),
}

# Korean/Japanese agent names are non-ASCII, so slugify() can't derive a
# filename slug from them. Map each to an explicit ASCII slug (used for the
# .md export path + agents.slug column). English agents keep slugify(name).
AGENT_SLUG_OVERRIDES: dict[str, str] = {
    "재즈 애호가": "jazz_lover",
    "카페 마니아": "cafe_lover",
    "인디 음악 PD": "indie_music_pd",
    "바이닐 컬렉터": "vinyl_collector",
    "요가 강사": "yoga_instructor",
    "등산 애호가": "hiking_enthusiast",
    "보드게임 마니아": "boardgame_geek",
    "책벌레": "bookworm",
    "ジャズ愛好家": "jazz_aficionado",
    "カフェ巡り": "cafe_hopper",
    "ラーメン研究家": "ramen_researcher",
    "ヨガ講師": "yoga_teacher",
    "レコードコレクター": "record_collector",
    "アニメファン": "anime_fan",
    "登山好き": "hiking_lover",
    "読書家": "bookworm_osaka",
}


def _build_frontmatter(
    agent: Agent, owner: User, lon: float | None, lat: float | None,
    owner_idx: int = 0, slug: str | None = None, locale: str = "en",
) -> AgentFrontmatter:
    """Compose v2 frontmatter from an existing v1 agent + owner row."""
    goal_category = _pick_goal_category(agent.tags or [])
    refs = _references_for(owner_idx, slug or slugify(agent.name))
    lang = _LOCALE_LANG.get(locale, "en-AU")
    fallback = _LOCALE_FALLBACK.get(locale, ["en-US"])
    timezone = _LOCALE_TZ.get(locale, "Australia/Brisbane")
    # Conservative defaults: open intent, online-only — users can tighten via UI
    relationship_intent = "open"
    compatible_intents = ["open", "friendship", "professional", "casual"]
    interaction_mode = "online_only"

    # Brisbane CBD fallback if user has no position
    base_lat = lat if lat is not None else -27.4679
    base_lon = lon if lon is not None else 153.0281

    return AgentFrontmatter(
        schema_version=1,
        revision=1,
        name=agent.name,
        slug=slug or slugify(agent.name),
        agent_id=agent.id,
        description=agent.description[:500],
        owner_user_id=owner.id,
        owner_display=owner.display_name,
        goal=agent.description[:300],
        goal_category=goal_category,
        interaction_mode=interaction_mode,
        relationship_intent=relationship_intent,
        compatible_intents=compatible_intents,
        tags=list(agent.tags or []),
        topics_of_interest=[],
        boundaries=Boundaries(
            avoid_topics=["politics", "religion"],
            language=lang,
            fallback_languages=fallback,
            formality="polite",
            nsfw=False,
        ),
        conversation_phases=ConversationPhases(
            warmup=Phase(turns="1-7", target="discover topical depth"),
            discovery=Phase(turns="8-18", target="find shared axis"),
            bonding=Phase(turns="19-30", target="test scenario fit"),
        ),
        escalation=Escalation(
            initial_turns=30,
            continue_threshold=0.6,
            extended_turns=30,
            offline_threshold=0.8,
            offline_meeting=OfflineMeeting(
                allowed=True,
                preferred_settings=["coffee_shop", "park"],
                avoid_settings=["private_residence"],
                duration_hint="1 hour, public place",
            ),
        ),
        safety=Safety(
            refuse_personal_info_share=True,
            require_owner_confirmation_for=STANDARD_OWNER_CONFIRM_FOR,
            redline_topics=STANDARD_REDLINE_TOPICS,
        ),
        location=Location(
            base_lat=base_lat,
            base_lon=base_lon,
            base_label=owner.suburb,
            travel_radius_km=10.0,
            preferred_areas=[owner.suburb] if owner.suburb else [],
        ),
        availability=Availability(
            active_hours="09:00-22:00",
            timezone=timezone,
            active_days=["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        ),
        llm=LLMSettings(
            model=owner.preferred_model or "claude-sonnet-4-5",
            temperature=0.7,
            max_tokens_per_turn=300,
        ),
        references=refs,
    )


def _populate_agent_v2(agent: Agent, fm: AgentFrontmatter) -> None:
    """Mirror the frontmatter into the DB row's v2 columns."""
    agent.slug = fm.slug
    agent.goal = fm.goal
    agent.goal_category = fm.goal_category
    agent.interaction_mode = fm.interaction_mode
    agent.relationship_intent = fm.relationship_intent
    agent.compatible_intents = list(fm.compatible_intents)
    agent.topics_of_interest = list(fm.topics_of_interest)
    agent.boundaries = fm.boundaries.model_dump()
    agent.conversation_phases = fm.conversation_phases.model_dump()
    agent.escalation_policy = fm.escalation.model_dump()
    agent.safety = fm.safety.model_dump()
    agent.availability = fm.availability.model_dump()
    agent.llm_settings = fm.llm.model_dump()
    agent.location_geohash5 = encode_geohash(fm.location.base_lat, fm.location.base_lon, 5)
    agent.location_label = fm.location.base_label
    agent.schema_version = fm.schema_version
    agent.revision = fm.revision
    agent.references_meta = (
        [r.model_dump() for r in fm.references] if fm.references else None
    )


def _write_reference_files(
    fm: AgentFrontmatter, owner_idx: int
) -> None:
    """Write `agents/{user_uuid}/{slug}/references/{name}.md` per reference."""
    if not fm.references:
        return
    refs_dir = AGENTS_DIR / str(fm.owner_user_id) / fm.slug / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)
    for ref in fm.references:
        body = REFERENCE_BODIES.get((owner_idx, fm.slug, ref.name))
        if body is None:
            continue
        (refs_dir / f"{ref.name}.md").write_text(body, encoding="utf-8")


def _export_agent_md(fm: AgentFrontmatter, body: str) -> Path:
    """Write `agents/{user_uuid}/{slug}.md`. Returns the relative path."""
    user_dir = AGENTS_DIR / str(fm.owner_user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    path = user_dir / f"{fm.slug}.md"
    path.write_text(render_agent_md(fm, body), encoding="utf-8")
    return path.relative_to(AGENTS_DIR.parent)


def _default_body(fm: AgentFrontmatter, persona_prompt: str, tone: str) -> str:
    """Plain markdown body derived from v1 persona_prompt."""
    return (
        f"# {fm.name} — Persona\n\n"
        f"## Role\n{persona_prompt}\n\n"
        f"## Tone\n{tone}\n\n"
        f"## Goal\n{fm.goal}\n"
    )


async def seed():
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Clear existing data for a clean reseed. Delete every table in reverse
        # dependency order (children before parents) straight from the ORM
        # metadata, so a newly added table with an FK can never reintroduce the
        # ordering bug this replaced: partner_evaluations, notifications, and
        # the island_* maps were each missing from the old hand-maintained list
        # and broke `DELETE FROM match_sessions` / `users` with FK violations.
        for table in reversed(Base.metadata.sorted_tables):
            await session.execute(delete(table))

        # System user (treasury for ISL genesis)
        system_user = User(
            id=_uuid(0), display_name="System", email="system@islume.local",
            is_active=False, is_visible=False, tier="system",
        )
        session.add(system_user)

        # On-chain escrow owner — receives the credit side of every withdrawal so
        # the double-entry invariant holds. Matches ESCROW_USER_ID in
        # services/wallet/main.py.
        escrow_user = User(
            id=UUID("00000000-0000-0000-0000-0000000000e5"),
            display_name="Escrow", email="escrow@islume.local",
            is_active=False, is_visible=False, tier="system",
        )
        session.add(escrow_user)

        # Create users
        user_objects = {}
        for uid, name, email, sex, age, job, suburb, radius, active, visible, tier, model in USERS:
            u = User(
                id=uid, display_name=name, email=email,
                sex=sex, age=age, job=job, suburb=suburb,
                find_radius_m=radius, is_active=active, is_visible=visible,
                tier=tier, preferred_model=model,
            )
            session.add(u)
            user_objects[uid] = u

        await session.flush()  # Ensure users exist before agents (FK constraint)

        # Create agents and link to users
        agent_count = 0
        used_slugs: dict[UUID, set[str]] = {}
        exported_paths: list[Path] = []
        for i, (aname, desc, prompt, tone, tags, owner_idx) in enumerate(AGENTS):
            owner_id = _uuid(owner_idx)
            agent = Agent(
                id=_agent_uuid(owner_idx, aname),
                name=aname,
                description=desc,
                persona_prompt=prompt,
                tone=tone,
                tags=tags,
                created_by=owner_id,
            )
            session.add(agent)
            await session.flush()  # Get agent.id

            # Activate the first agent for each user
            existing_active = sum(
                1 for j, (_, _, _, _, _, oidx) in enumerate(AGENTS[:i])
                if oidx == owner_idx
            )
            ua = UserAgent(
                user_id=owner_id,
                agent_id=agent.id,
                is_active=(existing_active == 0),  # First agent per user is active
            )
            session.add(ua)
            agent_count += 1

            # --- Agent.md v2: build frontmatter, populate columns, export file ---
            owner = user_objects[owner_id]
            pos = POSITIONS.get(owner_idx)
            lon, lat = (pos if pos else (None, None))
            fm = _build_frontmatter(
                agent, owner, lon, lat, owner_idx=owner_idx,
                slug=AGENT_SLUG_OVERRIDES.get(aname) or slugify(aname),
                locale=USER_LOCALES.get(owner_idx, "en"),
            )

            # Korean agents: switch conversation language + attach ko persona
            ko = KO_TRANSLATIONS.get(aname)
            if ko:
                fm.boundaries.language = "ko"
                fm.i18n = {"ko": Translation(**ko)}

            # Resolve slug collisions per owner (Step 1 spec: caller's responsibility)
            owner_slugs = used_slugs.setdefault(owner_id, set())
            base_slug, n = fm.slug, 2
            while fm.slug in owner_slugs:
                fm.slug = f"{base_slug}_{n}"[:50]
                n += 1
            owner_slugs.add(fm.slug)

            _populate_agent_v2(agent, fm)
            # _populate_agent_v2 mirrors fm.boundaries (incl. language="ko")
            # but not fm.i18n, so set the translations column explicitly.
            if ko:
                agent.translations = {"ko": ko}
            try:
                rel_path = _export_agent_md(fm, _default_body(fm, prompt, tone))
                agent.agent_md_path = str(rel_path)
                exported_paths.append(rel_path)
                _write_reference_files(fm, owner_idx)
            except OSError as e:
                # Best-effort: file export failing must not break seed
                print(f"WARN: failed to export {fm.slug}: {e}")

        await session.flush()
        print(f"Exported {len(exported_paths)} Agent.md files under agents/.")

        # --- Wallets + genesis ISL ---
        GENESIS_AMOUNT = 1000
        sys_pub, sys_enc_priv = generate_keypair()
        system_wallet = Wallet(
            id=_uuid(100), user_id=_uuid(0),
            public_key=sys_pub, encrypted_private_key=sys_enc_priv,
            balance=-GENESIS_AMOUNT * len(USERS),
        )
        session.add(system_wallet)
        await session.flush()

        # On-chain escrow wallet: balance == total ISL withdrawn on-chain.
        # Only ever credited, so it stays >= 0 (no negative-balance exemption).
        esc_pub, esc_enc_priv = generate_keypair()
        escrow_wallet = Wallet(
            id=UUID("00000000-0000-0000-0000-0000000000e6"),
            user_id=UUID("00000000-0000-0000-0000-0000000000e5"),
            public_key=esc_pub, encrypted_private_key=esc_enc_priv,
            balance=0,
        )
        session.add(escrow_wallet)
        await session.flush()

        for idx, (uid, _name, *_rest) in enumerate(USERS, 1):
            pub, enc_priv = generate_keypair()
            wallet = Wallet(
                id=_uuid(200 + idx), user_id=uid,
                public_key=pub, encrypted_private_key=enc_priv,
                balance=GENESIS_AMOUNT,
            )
            session.add(wallet)
            await session.flush()

            tx_id = _uuid(300 + idx)
            tx_data = build_tx_data(
                str(tx_id), str(system_wallet.id), str(wallet.id),
                GENESIS_AMOUNT, "ISL", "genesis",
            )
            sig = sign_transaction(system_wallet.encrypted_private_key, tx_data)

            session.add(LedgerEntry(
                tx_id=tx_id, account_id=system_wallet.id, amount=-GENESIS_AMOUNT,
                currency="ISL", tx_type="genesis", signature=sig,
            ))
            session.add(LedgerEntry(
                tx_id=tx_id, account_id=wallet.id, amount=GENESIS_AMOUNT,
                currency="ISL", tx_type="genesis", signature=sig,
            ))

        await session.commit()

    # Register all user positions in Redis GEO
    r = get_redis()
    await r.delete("geo:islands")  # Clear stale positions
    registered = 0
    for idx, (uid, _name, _, _, _, _, _, _, active, visible, *_) in enumerate(USERS, 1):
        if not active or not visible:
            continue  # Skip inactive/invisible users
        pos = POSITIONS.get(idx)
        if pos:
            lon, lat = pos
            await r.geoadd("geo:islands", [lon, lat, str(uid)])
            registered += 1
    # Cache wallet balances (TTL matches the wallet service's write-through)
    for uid, *_rest in USERS:
        await r.set(f"wallet:balance:{uid}", "1000", ex=60)

    await close_redis()

    print(f"Seeded {len(USERS)} users and {len(AGENTS)} agents.")
    print(f"Created {1 + len(USERS)} wallets (1 system + {len(USERS)} users) with 1000 ISL each.")
    print(f"Registered {registered} positions in Redis GEO.")
    for uid, name, _, _, _, _, suburb, *_ in USERS:
        print(f"  {name:10s} ({suburb:20s}) {uid}")


if __name__ == "__main__":
    asyncio.run(seed())
