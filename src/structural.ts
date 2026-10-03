// The structural concepts (docs/specs/built-ins.md section 4): the only concept names runtime code
// may refer to. Each group says why its names cannot be data on a word. A name used in runtime
// code, or in the seed without a declaration there, must be in this list (testing.md section 2).
//
// Groups marked "seed draft" were proposed while drafting the seed (seed/README.md) and are
// listed in built-ins.md beside the ones the specs fixed.

export interface Group {
  why: string;
  names: readonly string[];
}

export const STRUCTURAL = {
  dataModel: {
    why: "the shape of the data (ncon.md); the store and matcher cannot work without them",
    names: [
      "Concept", "Fact", "Reading", "Block", "Pack", "Retract",
      "Lemma", "Form", "Sense", "SenseOf", "PartOfSpeech", "Sounds", "IsA", "SameAs", "Said",
      // A concept said as words in order (an idiom, a phrasal verb): Words(Give(), Up()).
      "Words",
      "Active", "Proposed", "Pending", "Retracted",
      "Expand", "Collapse", "All",
      "Speaking", "Supposing", "Doing",
    ],
  },
  formFeatures: {
    why: "seed draft: what imports put on forms and what lexical rules are triggered by",
    names: ["Plural", "Past", "Present", "PastParticiple", "Gerund", "ThirdSingular", "Suffix", "Restore", "Undouble"],
  },
  chart: {
    why: "the chart's six steps read these facts and compare these categories by identity",
    names: [
      "Category", "Takes", "Modifies", "Joins", "FillsGap", "Tone", "OpensClause", "EndsClause",
      "SetsAside", "KeyNeighbours", "HasShape", "Left", "Right", "Modifier",
      // Arguments of Takes, Modifies, Joins and FillsGap.
      "Side", "Role", "Head", "Optional",
      // A slot's restriction to a kind of role its argument's word marks, and the fact on the word.
      "Marks",
      // The categories (built-ins.md section 4.2; Mark from the seed draft).
      "Noun", "Thing", "Act", "Clause", "Relation", "Property", "Manner", "Mark",
      // Seed draft: an entry's wrapper, the gap filler in heard expressions, the correction and
      // aside marks, role filling in lexical rules and readings, and Indent (runtime.md 3.2).
      "Wraps", "Heads", "Gap", "Segment", "Corrects", "Aside", "WithRoles", "Indent",
    ],
  },
  shapes: {
    why: "the shape interpreter reads them (runtime.md section 3.4)",
    names: ["Digits", "Letter", "Digit", "Lower", "Upper", "Space", "Any", "Literal", "Seq", "OneOf", "Repeat", "Shortest", "Capture"],
  },
  logicalForm: {
    why: "evaluation has one rule per speech act and rule checking reads Not and Only (logical-form.md); protected base",
    names: [
      "Question", "Assert", "Directive", "Advice", "Constraint",
      "Not", "Only", "Every", "Some", "If", "And", "Or", "Then", "Quote", "Mention", "Permit",
      // Taking back the last act that changed something, by the inverse recorded with it.
      "Undo",
      "Hole", "Label", "Outscopes", "Ref",
      "Now", "Past", "Future", "At", "Since", "Until", "During", "Before", "After", "Told", "LastChange",
      "Written", "Speaker", "Addressee",
      // LF argument kinds (logical-form.md section 3.1), checked when an LF is built.
      "Prop", "Act", "Thing", "Time", "Kind", "Rule",
      // Roles the LF heads take.
      // (To, a link's target, is a role the seed declares; as a head it is only ever the word "to",
      // which is read away, so it is not listed: a "to" left unread counts as unworked.)
      "About", "For", "Over", "Where", "Except", "Else", "Said",
      // Seed draft: what a core meaning takes, read by the LF kind check.
      "Frame",
    ],
  },
  scoring: {
    why: "want heads the runtime computes, feature templates (runtime.md 8.1, 8.2), and their weights",
    names: [
      "Near", "Doable",
      "WordsUsed", "CandidateSource", "WantedKind", "ShapeFit", "Neighbour", "SenseFrequency", "WordFrequency",
      // How common a word is (wordfreq's Zipf frequency), a fact on its concept that WordFrequency reads.
      "Frequency",
      "Evidence", "Match", "Unmatched", "Trust", "Coverage", "FocusFit", "FocusSource",
      "ReachedAct", "NeedsMet", "ChecksWouldPass", "Blocked", "UnknownEffects", "Unworked",
      "Feature", "Weight",
      // The kind a number literal is of when a want is scored (the seed's shape for digits).
      "Numeral",
      // The CandidateSource template's keys (runtime.md 3.3), and a set-aside span's.
      "Exact", "Inflected", "CaseMatch", "SpellDistance", "SoundDistance", "Stretched", "InPlay", "Shape", "Unknown", "SetAside",
      "CurrentConversation", "PastConversation", "UserFacts", "Workspace", "World",
      // Focus's budget per turn, per source (runtime.md 11b), a policy fact on Focus.
      "Focus", "Budget", "Lookups", "Candidates",
    ],
  },
  effects: {
    why: "guards attach to effect classes (runtime.md section 12); protected base",
    names: [
      "Deletes", "OverwritesHistory", "Publishes", "SendsOutside", "Spends", "UnknownEffects",
      "ChangesLocal", "ChangesGraph", "Speaks", "Reads",
    ],
  },
  trustAndConversation: {
    why: "the trust rules and the conversation structure are runtime mechanism over them (runtime.md 11 to 13)",
    names: [
      "Source", "TrustLevel", "Seed", "Derived", "Correction", "Config", "User", "Self",
      "Conversation", "Turn", "Event", "InPlay", "StandingRule", "Proposal", "Grant",
    ],
  },
  stuck: {
    why: "seed draft: the reasons the runtime records for an unworked expression (design section 23)",
    names: ["NoSense", "NoReading", "NeedUnmet", "NoSource", "NoPermission", "TooClose", "BlockedBy", "NoInverse"],
  },
  speaking: {
    why: "seed draft: what Say is handed to realize, and the printing step of design section 25b",
    names: [
      "Offer", "Echo", "Outcome", "Reply", "Target", "Checked", "Output", "Stopped",
      // An act kept for later (Schedule) whose time has come, said at the start of a turn.
      "Due",
      "Print", "Medium", "Printed", "Escaped", "Escapes", "Fenced", "Repeated", "Uppercase", "Capitalized",
      "Block", "Min", "Pad",
      // A child said as itself where it has words of its own, else the wrapper's fallback: what
      // lets a wrapper say only the wrapping ("Done: ...") and a child say itself (a command's run).
      "Either",
      // Run's argument list, which a command line is realized from.
      "Args",
    ],
  },
  know: {
    why: "Know, the one door to outside knowledge (runtime.md 14): what it keeps and the sources it asks",
    names: [
      "Know", "Found", "Page", "Title", "Wikipedia", "Wiktionary", "Wikidata", "Web", "AnswerShape", "Explanation", "Description",
      // What a page is about, learned (a Topic concept), and how its title is heard, so a question
      // that names it reaches it.
      "Topic", "Heard",
    ],
  },
  primitives: {
    why: "the only code that touches the world (built-ins.md section 2)",
    names: [
      "Store", "Remove", "Contains", "Set", "Remember", "Compare", "Count", "Rank", "Sort", "Filter",
      "Arithmetic", "Now", "Read", "Write", "Edit", "Run", "Schedule", "Say", "Ask", "Suppose", "Sequence",
    ],
  },
  primitiveResults: {
    why: "the structures primitives return; observation reads tools' machine formats as structure (runtime.md section 9)",
    names: [
      "File", "Directory", "Entry", "GitStatus", "GitLog", "GitBranches", "Changed", "Untracked", "GitCommit", "GitBranch",
      "Ran", "Args", "Joined", "Wrote", "Edited", "Replace", "Inserted", "Withdrawn",
      // Read of a manual page: the page, its parts, and its usage lines (Optional, Repeat, Literal
      // and Block are structural already).
      "ManPage", "Section", "Subsection", "Paragraph", "Item", "Synopsis", "Usage",
      "Choice", "Group", "Flag", "Option", "Placeholder", "Unparsed",
      // Roles of those structures that realizations read.
      "Path", "Media", "Exit", "Error", "Previous", "Term", "Summary", "Command",
      // How Sort and Rank order, and how Compare tests equality.
      "Name", "Same",
      // Arithmetic's operations: the primitive computes each, so it must know them by name. A root
      // is an Exponentiation and a percent a Division; the words that say them build those.
      "Addition", "Subtraction", "Multiplication", "Division", "Exponentiation", "Modulo",
      // What Remember keeps and returns (a rewrite the user taught).
      "Rewrite", "Remembered",
      // What Schedule keeps, and the schedule Read(Schedule()) lists it in; a unit's length in
      // seconds, which Schedule reads to work out a time ("in 10 minutes").
      "Scheduled", "Schedule", "Lasts",
    ],
  },
} as const satisfies Record<string, Group>;

/** Every structural name, once. */
export const STRUCTURAL_NAMES: ReadonlySet<string> = new Set(Object.values(STRUCTURAL).flatMap((g) => g.names));
