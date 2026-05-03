# Storage Event Hooks

aves-node provides storage event hooks that fire before and after data changes. These hooks allow you to implement custom persistence, auditing, logging, or validation without modifying the library code.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Event Types](#event-types)
- [Listener Interface](#listener-interface)
- [Before-Change Hooks](#before-change-hooks)
- [After-Change Hooks](#after-change-hooks)
- [Use Cases](#use-cases)
  - [Custom Persistence Database](#custom-persistence-database)
  - [Audit Logging](#audit-logging)
  - [Room Capacity Monitoring](#room-capacity-monitoring)
  - [Activity Tracking](#activity-tracking)
- [Full Example](#full-example)
- [Notes and Caveats](#notes-and-caveats)

---

## How It Works

Storage events are built into `BaseStorage`, the abstract base class that both `MemoryStorage` and `RedisStorage` extend. Each data mutation method (create, update, delete) follows a consistent pattern:

```
emitBeforeChange(event)  -->  perform mutation  -->  emitAfterChange(event)
```

If any `onBeforeChange` listener returns `false`, the mutation is **cancelled** — the data is not written and no `after` event fires.

### Event Coverage by Storage Method

| Storage Method          | Before Event          | After Event           |
|------------------------|-----------------------|-----------------------|
| `setRoom` (new room)   | `room:create`         | `room:create`         |
| `setRoom` (existing)   | `room:update`         | `room:update`         |
| `deleteRoom`           | `room:delete`         | `room:delete`         |
| `setParticipant`       | `participant:join`    | `participant:join`    |
| `deleteParticipant`    | `participant:leave`   | `participant:leave`   |
| `setUserRoom`          | `user:bindRoom`       | `user:bindRoom`       |
| `deleteUserRoom`       | `user:unbindRoom`     | `user:unbindRoom`     |

**Note:** `getRoom`, `getAllRooms`, `roomExists`, `getUserRoom`, `getParticipant`, and `getAllParticipants` are read-only operations and do not fire events.

---

## Event Types

### DataChangeType

```ts
type DataChangeType =
  | "room:create"
  | "room:update"
  | "room:delete"
  | "participant:join"
  | "participant:leave"
  | "user:bindRoom"
  | "user:unbindRoom";
```

### Common Fields

Every event extends `DataChangeEvent`:

```ts
interface DataChangeEvent {
  type: DataChangeType;
  timestamp: number;       // Date.now() when the event was created
}
```

### Room Events

**`room:create`** (`RoomCreateEvent`)

| Field      | Type       | Description                    |
|------------|------------|--------------------------------|
| `type`     | `"room:create"` |                            |
| `roomId`   | `string`   | The new room's ID              |
| `room`     | `RoomData` | Serialized room (see below)    |

**`room:update`** (`RoomUpdateEvent`)

| Field      | Type            | Description                    |
|------------|-----------------|--------------------------------|
| `type`     | `"room:update"` |                                |
| `roomId`   | `string`        | Updated room's ID              |
| `before`   | `RoomData \| null` | Room state before the update (null if unknown) |
| `after`    | `RoomData`      | Room state after the update    |

**`room:delete`** (`RoomDeleteEvent`)

| Field      | Type            | Description                    |
|------------|-----------------|--------------------------------|
| `type`     | `"room:delete"` |                                |
| `roomId`   | `string`        | Deleted room's ID              |
| `room`     | `RoomData`      | Room state at time of deletion |

### Participant Events

**`participant:join`** (`ParticipantJoinEvent`)

| Field         | Type              | Description                      |
|---------------|-------------------|----------------------------------|
| `type`        | `"participant:join"` |                              |
| `roomId`      | `string`          | Room the participant joined      |
| `userId`      | `string`          | User who joined                  |
| `participant` | `ParticipantData` | Serialized participant info      |

**`participant:leave`** (`ParticipantLeaveEvent`)

| Field         | Type                 | Description                    |
|---------------|----------------------|--------------------------------|
| `type`        | `"participant:leave"`|                                |
| `roomId`      | `string`             | Room the participant left      |
| `userId`      | `string`             | User who left                  |
| `participant` | `ParticipantData`    | Serialized participant info    |

### User-Room Binding Events

**`user:bindRoom`** (`UserBindRoomEvent`)

| Field      | Type               | Description                        |
|------------|--------------------|------------------------------------|
| `type`     | `"user:bindRoom"`  |                                    |
| `userId`   | `string`           | User being bound                   |
| `roomId`   | `string`           | Room the user is bound to          |

**`user:unbindRoom`** (`UserUnbindRoomEvent`)

| Field      | Type                 | Description                          |
|------------|----------------------|--------------------------------------|
| `type`     | `"user:unbindRoom"`  |                                      |
| `userId`   | `string`             | User being unbound                   |
| `roomId`   | `string`             | Room the user is unbound from        |

### Serializable Data Types

Events use serializable data (no WebSocket references) for portability:

**`RoomData`**

```ts
interface RoomData {
  id: string;
  name?: string;
  maxCapacity?: number;
  password?: string;          // scrypt hash, if the room is password-protected
  participantCount: number;  // number of participants at event time
  createdAt: number;
}
```

**`ParticipantData`**

```ts
interface ParticipantData {
  userId: string;
  userName: string;
}
```

---

## Listener Interface

```ts
interface IStorageEventListener {
  /** Called before a data change. Return false to cancel the operation. */
  onBeforeChange?: BeforeChangeCallback;
  /** Called after a data change has been committed. */
  onAfterChange?: AfterChangeCallback;
}

type BeforeChangeCallback = (event: StorageEvent) => Promise<boolean> | boolean;
type AfterChangeCallback = (event: StorageEvent) => Promise<void> | void;
```

### Registering Listeners

```ts
const storage = server.getStorage();

// Type-safe with a single object
storage.addListener({
  onBeforeChange: (event) => {
    if (event.type === "room:create" && event.room.participantCount > 100) {
      console.warn(`Room ${event.roomId} has many participants`);
    }
    return true; // allow the operation
  },
  onAfterChange: (event) => {
    console.log(`[audit] ${event.type} at ${new Date(event.timestamp).toISOString()}`);
  },
});
```

### Managing Listeners

```ts
// Add multiple listeners
storage.addListener(listenerA);
storage.addListener(listenerB);

// Remove a specific listener
storage.removeListener(listenerA);

// Clear all listeners
storage.clearListeners();
```

---

## Before-Change Hooks

Use `onBeforeChange` to:

- **Validate or reject** operations based on custom rules.
- **Enforce business logic** (e.g., deny room creation after hours).
- **Log attempted changes** for monitoring.

Return `false` (or a Promise resolving to `false`) to cancel the operation. Return `true` to allow it.

### Cancellation Behavior

When an `onBeforeChange` hook returns `false`:

- The mutation does NOT occur.
- `onAfterChange` is NOT called.
- The calling code continues normally (the cancel is silent — the server does not send an error to the client).

If you need to notify the client about a rejection, implement the check at the `RoomManager` or `AvesServer` layer instead.

### Cancellation Example

```ts
// Reject room creation after hours
storage.addListener({
  onBeforeChange: (event) => {
    if (event.type === "room:create") {
      const hour = new Date().getHours();
      if (hour < 6 || hour > 22) {
        console.warn(`Blocked room creation at hour ${hour}`);
        return false; // cancel
      }
    }
    return true;
  },
});
```

---

## After-Change Hooks

Use `onAfterChange` to:

- **Persist data** to an external database (PostgreSQL, MongoDB, etc.).
- **Write audit logs** for compliance.
- **Emit metrics** to monitoring systems (Prometheus, DataDog, etc.).
- **Trigger side-effects** (webhooks, notifications, etc.).

After-change hooks run after the mutation has been committed to the storage backend. They cannot cancel the operation (the data has already been written), but they can throw — consider wrapping your hook logic in try-catch to prevent one listener's failure from affecting others.

---

## Use Cases

### Custom Persistence Database

Persist room and participant events to PostgreSQL for long-term storage:

```ts
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const storage = server.getStorage();
if ("addListener" in storage) {
  storage.addListener({
    onAfterChange: async (event) => {
      try {
        switch (event.type) {
          case "room:create":
            await pool.query(
              "INSERT INTO rooms (id, name, max_capacity, has_password, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5::float / 1000))",
              [event.roomId, event.room.name, event.room.maxCapacity, !!event.room.password, event.timestamp],
            );
            break;

          case "room:delete":
            await pool.query("DELETE FROM rooms WHERE id = $1", [event.roomId]);
            break;

          case "participant:join":
            await pool.query(
              "INSERT INTO room_participants (room_id, user_id, user_name, joined_at) VALUES ($1, $2, $3, to_timestamp($4::float / 1000))",
              [event.roomId, event.userId, event.participant.userName, event.timestamp],
            );
            break;

          case "participant:leave":
            await pool.query(
              "UPDATE room_participants SET left_at = to_timestamp($2::float / 1000) WHERE room_id = $1 AND user_id = $3 AND left_at IS NULL",
              [event.roomId, event.timestamp, event.userId],
            );
            break;
        }
      } catch (error) {
        console.error("Persistence error:", error);
      }
    },
  });
}
```

### Audit Logging

Log all room and participant activity with structured metadata:

```ts
interface AuditEntry {
  timestamp: string;
  type: string;
  roomId?: string;
  userId?: string;
  details: Record<string, unknown>;
}

const auditLog: AuditEntry[] = [];

storage.addListener({
  onAfterChange: (event) => {
    const entry: AuditEntry = {
      timestamp: new Date(event.timestamp).toISOString(),
      type: event.type,
      details: {},
    };

    switch (event.type) {
      case "room:create":
      case "room:delete":
        entry.roomId = event.roomId;
        entry.details = { name: event.room.name, participantCount: event.room.participantCount };
        break;
      case "participant:join":
      case "participant:leave":
        entry.roomId = event.roomId;
        entry.userId = event.userId;
        entry.details = { userName: event.participant.userName };
        break;
      case "user:bindRoom":
      case "user:unbindRoom":
        entry.userId = event.userId;
        entry.roomId = event.roomId;
        break;
    }

    auditLog.push(entry);
  },
});
```

### Room Capacity Monitoring

Warn when rooms approach capacity:

```ts
storage.addListener({
  onAfterChange: (event) => {
    if (event.type === "participant:join") {
      // Look up the room's max capacity from storage
      server.getRoomInfo(event.roomId).then((info) => {
        if (info?.maxCapacity) {
          const fillPercent = (info.participantCount / info.maxCapacity) * 100;
          if (fillPercent >= 90) {
            console.warn(
              `Room ${event.roomId} is at ${fillPercent.toFixed(0)}% capacity ` +
              `(${info.participantCount}/${info.maxCapacity})`
            );
          }
        }
      });
    }
  },
});
```

### Activity Tracking

Track user activity for presence or billing:

```ts
storage.addListener({
  onAfterChange: (event) => {
    if (event.type === "participant:join") {
      trackUserOnline(event.userId, event.roomId, event.timestamp);
    }
    if (event.type === "participant:leave") {
      trackUserOffline(event.userId, event.timestamp);
    }
  },
});
```

---

## Full Example

A complete setup with persistent storage and metrics:

```ts
import { AvesServer } from "@yrzhao/aves-node";
import { WebSocketServer } from "ws";
import { Pool } from "pg";
import { Counter } from "prom-client";

// --- Setup ---

const server = new AvesServer({ debug: true });
const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws, req) => server.handleConnection(ws, req));

// --- Metrics ---

const roomsCreated = new Counter({ name: "aves_rooms_created_total", help: "Total rooms created" });
const participantsJoined = new Counter({ name: "aves_participants_joined_total", help: "Total participants joined" });

// --- PostgreSQL persistence ---

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT,
      has_password BOOLEAN DEFAULT FALSE,
      participant_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS room_participants (
      room_id TEXT REFERENCES rooms(id),
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      PRIMARY KEY (room_id, user_id)
    );
  `);
}

void initDatabase();

// --- Event listeners ---

const storage = server.getStorage();
if ("addListener" in storage) {
  storage.addListener({
    onBeforeChange: (event) => {
      // Log all attempted changes
      console.log(`[before] ${event.type}`, { roomId: "roomId" in event ? event.roomId : undefined });
      return true;
    },
    onAfterChange: async (event) => {
      try {
        switch (event.type) {
          case "room:create":
            roomsCreated.inc();
            await pool.query(
              "INSERT INTO rooms (id, name, has_password, participant_count, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5::float / 1000)) ON CONFLICT DO NOTHING",
              [event.roomId, event.room.name, !!event.room.password, event.room.participantCount, event.timestamp],
            );
            break;

          case "room:delete":
            await pool.query("UPDATE rooms SET participant_count = $2 WHERE id = $1", [event.roomId, event.room.participantCount]);
            break;

          case "participant:join":
            participantsJoined.inc();
            await pool.query(
              "INSERT INTO room_participants (room_id, user_id, user_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [event.roomId, event.userId, event.participant.userName],
            );
            break;

          case "participant:leave":
            await pool.query(
              "UPDATE room_participants SET left_at = NOW() WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL",
              [event.roomId, event.userId],
            );
            break;
        }
      } catch (error) {
        console.error(`Failed to persist ${event.type}:`, error);
      }
    },
  });
}

// --- Shutdown ---

process.on("SIGTERM", () => {
  server.close();
  wss.close();
  void pool.end();
});
```

---

## Notes and Caveats

1. **Event listeners are instance-local.** In a multi-instance Redis deployment, a listener registered on instance-1 does not run for operations performed on instance-2. Each instance fires events independently.

2. **Event data is serializable.** Event payloads use `RoomData` and `ParticipantData`, which exclude WebSocket references. This makes events safe to serialize for external systems.

3. **Before-hook cancellation is silent.** Returning `false` from `onBeforeChange` cancels the mutation, but the server does not send an error back to the client. For user-facing validation, implement the check at the `AvesServer` or `RoomManager` layer.

4. **After-hook errors do not roll back.** If an `onAfterChange` listener throws, the data mutation has already been committed. Wrap async hooks in try-catch to prevent a single listener failure from propagating.

5. **The `addListener` method is only available on `BaseStorage` subclasses.** The `IDataStorage` interface does not include event listener methods. Use a type guard or check for the method's existence:

   ```ts
   const storage = server.getStorage();
   if ("addListener" in storage) {
     storage.addListener({ ... });
   }
   ```

6. **`room:update` events.** `room:update` fires only when `setRoom` is called for an existing room. In normal operation, rooms are created once and deleted when empty, so update events are rare. They would occur if you directly call `storage.setRoom` with a room ID that already exists.

7. **`user:bindRoom` vs `participant:join`.** These are separate events because they represent distinct operations in the storage layer:
   - `user:bindRoom` — atomically binds a userId to a room (prevents multi-room binding).
   - `participant:join` — stores the participant's WebSocket and metadata in the room.
   
   In the normal join flow, both events fire in sequence (bindRoom first, then participant:join).
