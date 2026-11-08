The live fixture card (`../live/events/bbbb1111bbbb1111.json`) as the engine publishes it once the card is over: all
four bouts decided, each with its `elo` at the time. The live-poll tests (unit, component, e2e) and the dev mock
(`astro dev` with `?live-api=/__live-mock`) reveal these results bout by bout on top of the static 2-of-4 page.
