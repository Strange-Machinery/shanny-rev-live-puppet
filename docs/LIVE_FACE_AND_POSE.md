# Live facial performance and uninterrupted body poses

The Buff player retains the original CharacterMouthRouter: 121 Shanny routes and
35 Rev routes. The playing AudioSource drives open, wide and round mouth channels,
including existing teeth, tongue and attachment routes. This is immediate waveform
and spectrum articulation, not phoneme alignment. No Rhubarb job or additional
planning pass delays speech.

Each validated Qwen line carries an actor-specific mood. Shanny supports anger,
rage, crying, smug and surprised; Rev supports pacifying, irritated, rage,
skeptical and surprised. The original expression bindings animate brows, eyes,
cheeks and mouth corners, with asymmetric skeptical brows, independent blinks,
smoothed transitions and voice-energy emphasis. Expressions never overwrite the
speech jaw. After a line, the current expression eases to a quieter listening
version rather than abruptly returning to a neutral face.

The local Buff OmniVoice worker preloads the private profile's saved references
in one resident model. It chooses the reference using the same validated mood
as the facial performance. It retains the existing model, generation settings,
source/reference checksums and saved-prompt verification. An unconfigured legacy
worker still uses its existing fixed actor references. Private reference IDs,
assets and model files are not included in source.

The six M16 banks for each actor are imported and checked before Ready. Five
contain a calibration origin at time zero, with an 80–90 degree arm discontinuity
to the first performance frame at 1/30 second. The live consumer replaces only
that loaded origin pose with the adjacent performance pose. The shared Shanny/Rev
consumer applies the same repair to selected episode/short banks. Original files and
checksums, source frame times, contact flags and fitted actor bindings are retained.
The live player never presents the calibration frame.

The final body owner holds a sampled seated pose. New gestures blend from the
current pose. Interruptions capture that pose and ease back to seated listening;
they do not reset the body or truncate the source clock to an earlier frame.
A delayed render frame cannot consume the entire return blend in one step.
Body choices remain the actual qualified M16 aliases: objection, conversation,
quiet listening or open explanation. Those are not relabelled as separately
qualified rage, crying or pacification body takes.

The mild left-arm fit rotates Shanny's complete captured chain outward twelve
degrees for the four conversational gestures, preserving local elbow/wrist motion.
Shared partner gaze uses anatomical facing calibrated in the authored source pose,
bounded neck/head yaw and eye rotation, and snapshot targets for both actors.
Direct speaking contact holds across short gaps. Rev's indirect listening look
keeps the head mostly forward, tilts slightly and shifts the eyes sideways/upward,
with an asymmetric irritated face. Rain retains its own full-body routine instead.
See [prepared popup and donation handoff](BUFF_POPUP.md).

The active machine profile must point at the rebuilt BuffStankTank player and
the local Buff worker. The previous producer profile is preserved privately.
Run BuffRigChecks.Run against the isolated Unity project to verify all routes,
ten distinct face profiles, speech-jaw preservation, seated idle and gesture
entry/interruption continuity. Hardware evidence is kept outside source control.
