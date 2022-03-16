jsfit
========
JavaScript FIT file encoder and decoder

Create Garmin .FIT files for your sports activities in pure JS.

Compatibility
--------
* Browsers >= Good
* NodeJS >= 14 (some versions of 13 too)


Usage
--------
### Browser

```js
import * as fit from './path/to/fit.mjs';

const fitParser = new fit.FitParser();
fitParser.addMessage('file_id', {
    manufacturer: 'strava',
    type: 'segment',
    time_created: new Date()
});
fitParser.addMessage('segment_id', {
    name: 'testing live segment',
    enabled: true,
    sport: 'cycling',
    selection_type: 'starred',
    uuid: 'foobar',
    default_race_leader: 1,
});
fitParser.addMessage('segment_lap', {
    uuid: 'foobar',
    total_distance: 625,
    start_position_lat: 43.67,
    start_position_long: -116.16,
    swc_lat: 43.67,
    swc_long: -116.16,
    nec_lat: 43.7048,
    nec_long: -116.105,
    end_position_lat: 43.7,
    end_position_long: -116.10,
    message_index: {
        flags: [],
        value: 0
    }
});
fitParser.addMessage('segment_leaderboard_entry', {
    activity_id_string: 'randomid',
    segment_time: 2023.0,
    type: 'rival',
    name: 'The man from town',
    message_index: {
        flags: [],
        value: 0
    }
});
fitParser.addMessage('segment_point', {
    altitude: 1098.8,
    distance: 0.0,
    position_lat: 43.6766,
    position_long: -116.16099,
    leader_time: [0.0],
    message_index: {
        flags: [],
        value: 0
    }
});
fitParser.addMessage('segment_point', {
    altitude: 1198.8,
    distance: 1.0,
    position_lat: 44.6766,
    position_long: -117.16099,
    leader_time: [2.0],
    message_index: {
        flags: [],
        value: 1 
    }
});
const u8Arr = fitParser.encode();
console.info("Here it is:", u8Arr);
```
