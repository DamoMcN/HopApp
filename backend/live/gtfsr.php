<?php
// Reads the National Transport Authority's live bus feed (GTFS-Realtime).
// The feed is protobuf, a compact binary format. This file reads just the parts the map needs,
// so no extra libraries or installs are required.
//
// Protobuf fields used (from the GTFS-Realtime spec):
//   FeedMessage:     entity = 2 (repeated)
//   FeedEntity:      id = 1, vehicle = 4
//   VehiclePosition: trip = 1, position = 2, timestamp = 5
//   TripDescriptor:  route_id = 5
//   Position:        latitude = 1, longitude = 2, speed = 5   (all 32-bit floats; speed is metres per second)

declare(strict_types=1);

function pb_varint(string $bytes, int &$pos, int $end): int
{
    $result = 0;
    $shift = 0;
    while ($pos < $end) {
        $byte = ord($bytes[$pos++]);
        $result |= ($byte & 0x7F) << $shift;
        if (($byte & 0x80) === 0) {
            return $result;
        }
        $shift += 7;
        if ($shift > 63) {
            throw new RuntimeException('Bad number in live data');
        }
    }
    throw new RuntimeException('Live data ended unexpectedly');
}

// Yields [field number, wire type, value]. Length-delimited, 32-bit and 64-bit values come back as raw strings.
function pb_fields(string $bytes): Generator
{
    $pos = 0;
    $end = strlen($bytes);
    while ($pos < $end) {
        $tag = pb_varint($bytes, $pos, $end);
        $field = $tag >> 3;
        $wire = $tag & 7;

        if ($wire === 0) {
            yield [$field, 0, pb_varint($bytes, $pos, $end)];
        } elseif ($wire === 2) {
            $length = pb_varint($bytes, $pos, $end);
            if ($length < 0 || $pos + $length > $end) {
                throw new RuntimeException('Live data is cut short');
            }
            yield [$field, 2, substr($bytes, $pos, $length)];
            $pos += $length;
        } elseif ($wire === 5 || $wire === 1) {
            $size = $wire === 5 ? 4 : 8;
            if ($pos + $size > $end) {
                throw new RuntimeException('Live data is cut short');
            }
            yield [$field, $wire, substr($bytes, $pos, $size)];
            $pos += $size;
        } else {
            throw new RuntimeException('Unsupported live data format');
        }
    }
}

function pb_float(string $raw): float
{
    return unpack('g', $raw)[1];   // little-endian 32-bit float
}

// Returns [{id, routeId, lat, lon, speed, timestamp}, ...] for every bus in the feed
function decode_vehicles(string $feed): array
{
    $vehicles = [];

    foreach (pb_fields($feed) as [$field, $wire, $entity]) {
        if ($field !== 2 || $wire !== 2) {
            continue;   // not an entity (for example the feed header)
        }

        $id = '';
        $vehicleMessage = null;
        foreach (pb_fields($entity) as [$f, $w, $v]) {
            if ($f === 1 && $w === 2) {
                $id = $v;
            } elseif ($f === 4 && $w === 2) {
                $vehicleMessage = $v;
            }
        }
        if ($vehicleMessage === null) {
            continue;   // not a vehicle (for example a trip update)
        }

        $hasTrip = false;
        $routeId = null;
        $lat = null;
        $lon = null;
        $speed = null;
        $timestamp = null;

        foreach (pb_fields($vehicleMessage) as [$f, $w, $v]) {
            if ($f === 1 && $w === 2) {
                $hasTrip = true;
                foreach (pb_fields($v) as [$tf, $tw, $tv]) {
                    if ($tf === 5 && $tw === 2) {
                        $routeId = $tv;
                    }
                }
            } elseif ($f === 2 && $w === 2) {
                foreach (pb_fields($v) as [$pf, $pw, $pv]) {
                    if ($pw !== 5) {
                        continue;
                    }
                    if ($pf === 1) {
                        $lat = pb_float($pv);
                    } elseif ($pf === 2) {
                        $lon = pb_float($pv);
                    } elseif ($pf === 5) {
                        $speed = pb_float($pv);
                    }
                }
            } elseif ($f === 5 && $w === 0) {
                $timestamp = $v;
            }
        }

        if (!$hasTrip || $lat === null || $lon === null) {
            continue;
        }

        $vehicles[] = [
            'id'        => $id,
            'routeId'   => $routeId,
            'lat'       => round($lat, 6),
            'lon'       => round($lon, 6),
            'speed'     => ($speed !== null && $speed > 0) ? round($speed, 2) : null,   // metres per second
            'timestamp' => $timestamp,
        ];
    }

    return $vehicles;
}
