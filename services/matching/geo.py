"""Redis GEO operations for island positions."""
from uuid import UUID

from shared.redis_client import get_redis

GEO_KEY = "geo:islands"


async def update_position(user_id: UUID, lon: float, lat: float) -> None:
    r = get_redis()
    await r.geoadd(GEO_KEY, [lon, lat, str(user_id)])


async def remove_position(user_id: UUID) -> None:
    r = get_redis()
    await r.zrem(GEO_KEY, str(user_id))


async def get_position(user_id: UUID) -> tuple[float, float] | None:
    r = get_redis()
    result = await r.geopos(GEO_KEY, str(user_id))
    if not result or result[0] is None:
        return None
    lon, lat = result[0]
    return float(lon), float(lat)


async def search_nearby(
    lon: float,
    lat: float,
    radius_m: float,
    exclude: UUID | None = None,
    limit: int = 100,
) -> list[tuple[UUID, float, float, float]]:
    """Return list of (user_id, lon, lat, distance_m) within radius."""
    r = get_redis()
    # count includes the excluded user, so request one extra
    count = limit + 1 if exclude else limit
    results = await r.geosearch(
        GEO_KEY,
        longitude=lon,
        latitude=lat,
        radius=radius_m,
        unit="m",
        withcoord=True,
        withdist=True,
        sort="ASC",
        count=count,
    )
    out = []
    exclude_str = str(exclude) if exclude else None
    for item in results:
        member, dist, coord = item[0], item[1], item[2]
        if member == exclude_str:
            continue
        out.append((UUID(member), float(coord[0]), float(coord[1]), float(dist)))
    return out
