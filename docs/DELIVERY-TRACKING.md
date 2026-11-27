# Delivery: tracking links and delivery platforms

## Rider position and the customer tracking link
Riders on shift share their position from the Rider app (**My deliveries**). Managers see each rider's last seen time and a map link on **Delivery**.

For a delivery order, **Delivery → Customer link** makes a link for the customer (shared with the phone's share sheet, or copied). It is signed, belongs to that one delivery and expires after 12 hours. The page shows the steps (preparing, rider assigned, on the way, delivered) and refreshes every 10 seconds.
- **While the rider has picked the order up and is sharing a fresh position** (under 5 minutes old), the customer sees the rider's first name, the distance to the delivery pin, a rough arrival time and a map link. The arrival time is an estimate (about 18 km/h in a straight line) and is labelled as one.
- **At any other time** (before pickup, after delivery, rider off shift or position stale) the customer sees only the status and a plain note. The rider's phone, full name and other orders are never shown.
- The link works only for a delivery order of that branch; a bill link cannot be used as a tracking link.
This shows position, distance and an estimate; it does not draw a live map or route.

## Delivery platforms (Zomato, Swiggy and aggregators)
Orders from platforms arrive through a **signed webhook** that OrderRestro publishes (see [INTEGRATIONS.md](INTEGRATIONS.md)): from the platform's merchant webhook where it has one, or from an aggregator you already pay for (UrbanPiper, Petpooja, Dotpe) that forwards those orders. The integration shows **Connected** only after a correctly signed order really arrives. There are no direct Zomato or Swiggy API clients: those need partner credentials that each restaurant must obtain from the platform.
