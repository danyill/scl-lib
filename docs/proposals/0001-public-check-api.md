# Proposal: a public check API for scl-lib

| Field | Value |
|---|---|
| Status | Draft for review, revision 4 |
| Parent issue | [#109 Error handling in functions](https://github.com/openscd/scl-lib/issues/109) |
| Discussion | [Zulip `#457465`, topic `scl-lib`](https://openscd.zulipchat.com/#narrow/channel/457465/topic/scl-lib/near/634236716) |
| Review | Comment on this file in the pull request diff, or answer the decisions in Section 5 |
| Scope | Design only. No code changes. |

## How to review

1. Read Sections 1 to 4. They give the problem, the evidence, the API and the categories.
2. Read Section 5. It has 15 decisions. Each decision gives the options and our preferred answer.
3. Reply with the decision number and the letter. Example: `D5: B`.

The letters are not a ranking. In most decisions, the preferred answer is the first option.

## 1. Problem

The library can show which edit an operation makes. It can also show "no edit" with `null` or `[]`. It cannot show **why** there is no edit.

```ts
const insert = createDataSet(ln0, { attributes: { name: "DS1" } });
// null — no LN0 in the parent? name in use? maximum reached?
```

One value covers three causes. A plugin cannot use this value to disable a button or to explain the problem.

Four element families have a `canAdd*` check that `index.ts` does not export. The two checks that it exports return only a boolean.

## 2. Evidence

### 2.1 What we did

We studied the SCL files that users open, not the test files of the library.

- We collected 716 files with the extension `.scd`, `.cid` or `.icd` from three local directories. The directories contain project files, vendor files and test material.
- We selected 120 files at a fixed interval from the sorted list. We added the four largest files to the selection.
- We read each file one time and counted the conditions in Table 1.
- We compared the counts with the schema constraints in `IEC_61850-6.2018.SCL.2007B4.full`: `xs:unique`, `xs:key` and `xs:keyref`. We also compared them with the rules of the `Services` element.

### 2.2 Why we did it

Each condition in Table 1 needs a decision in the library: permit the operation or refuse it. A decision for a rare condition can be strict. A decision for a condition in half of the files must not block the user. The counts show which conditions occur, and which rule would break real files.

The counts also show where the current rules disagree with the files. A disagreement is a defect in the library, or a defect in the file. Either result is important for the design.

### 2.3 What we found

**Table 1: Conditions in the sample**

| Condition | Count | Files |
|---|---|---|
| IED with no `Services` element | 83 of 676 | — |
| IED that uses a service that it does not declare | 221 IEDs | 58 of 120 |
| Service declared with `max="0"` | `GOOSE` 44, `SMVsc` 12 | — |
| `SupSubscription` with `maxGo` or `maxSv` equal to 0 | 254 of 397 | — |
| Scope above `ConfReportControl@max`, instances counted | 72 | 24 |
| Scope above `ConfReportControl@max`, blocks counted | 6 | 2 |
| Control block with no `ConnectedAP` | 86 | 18 |
| Pointer with no target (`lnType`, `datSet`, `iedName`) | 27 ids, 9 refs, 43 ids | 17, 8, 4 |
| `ExtRef` with `pDO` | 9,294 of 40,321 | 49 of 103 have none |
| `Private` element | 76,612 | 102 of 120 |

Table 4 in Appendix A gives the full list.

### 2.4 What the evidence changed

1. **The default policy.** 83 IEDs have no `Services` element. 58 of 120 files use a service that they do not declare. A strict default refuses edits in half of the sample. The library must permit these edits and offer a strict option. This result sets D5 and D6.

2. **`max="0"` is not an absent declaration.** 44 `GOOSE` declarations and 12 `SMVsc` declarations use zero. The file says that the service does not exist. A zero declaration must always refuse, with its own reason code. Only an absent declaration follows the policy. This result sets the `capability-zero` code.

3. **The report counting rule is a defect.** The current library counts `RptEnabled@max` instances. That rule refuses 72 scopes in 24 of 120 files. A rule that counts control blocks refuses 6 scopes in 2 files. The library refuses valid edits in one fifth of the sample. This result sets D15 and makes it a fix, not a policy choice.

4. **A create function can omit a requested part.** 86 control blocks in 18 files have no `ConnectedAP` element. The create function returns the control block and no `GSE` or `SMV`. The caller cannot see this. The check must answer for the part that the caller requests. This result sets D8.

5. **Real files contain reference faults.** 27 `lnType` ids, 9 `datSet` references and 43 `iedName` ids have no target. These faults occur in 17, 8 and 4 files. The library must be able to report these faults. It must not use them to refuse an unrelated edit. This result sets the `reference` category and the document check in Appendix E.

6. **Most `ExtRef` elements have no restriction data.** Only 9,294 of 40,321 elements have `pDO`. 49 of 103 files have no `pDO` at all. A restriction check cannot run on most elements. An absent restriction must permit the operation. This result sets the `restriction-undeclared` code.

7. **Vendor content is normal.** The sample contains 76,612 `Private` elements in 102 files. The library must ignore content that it does not know. It must not refuse an operation because of it.

### 2.5 What the study does not show

- The sample is not a random sample of all SCL files. It is the material that was available on one machine.
- The study counts conditions. It does not decide which party is correct. A maximum that a file exceeds can be a fault in the file or a different reading of the standard.
- The report control rows show two readings of `ConfReportControl@max`. D15 asks the reviewers to agree the reading.

## 3. Proposed API

The library gets one check function for each create function:

```
checkAddDataSet            checkAddFCDA
checkAddGSEControl         checkInstantiateSubscriptionSupervision
checkAddReportControl      checkAddSampledValueControl
```

Each function returns the first constraint that prevents the operation. It also returns the values that it compared.

### 3.1 Result

```ts
export type LimitInfo = {
  scope: "AccessPoint" | "IED" | "LDevice" | "LN" | "unbounded";
  max?: number;
  maxBuffered?: number;
  current?: number;
};

export type CheckResult =
  | { allowed: true; limits?: LimitInfo }
  | {
      allowed: false;
      reason: SclReasonDetails;                          // always reasons[0]
      reasons?: [SclReasonDetails, ...SclReasonDetails[]];
    };
```

`reason` is one object. The field `key` selects the variant. Each variant contains only its own fields and one English sentence in `reasonText`.

```ts
const check = checkAddReportControl(ln0, { buffered: true });
addButton.disabled = !check.allowed;

if (!check.allowed) {
  const d = check.reason;
  switch (d.key) {
    case "limit-buffered-reached":
      addButton.title = d.reasonText;
      break;
    default:
      addButton.title = d.reasonText;
  }
}
```

`reasonText` is a complete sentence. The library fills in the values. Example: "The maximum number of buffered ReportControl instances (4 of 4) has been reached."

A host that wants its own text uses the same fields: `d.buffered`, `d.maxBuffered`, `d.tag`. A host that wants another language ignores `reasonText`. Appendix D gives all variants.

### 3.2 All reasons

`check*` stops at the first reason. The caller can set `all: true` to get every independent reason for the same options.

```ts
checkAddReportControl(ln0, { all: true })
// { allowed: false,
//   reason: { key: "limit-reached", … },        // reasons[0]
//   reasons: [ limit-reached, identity-name-taken, reference-missing ] }
```

Use `check*` for the tooltip of one row. Use `all: true` for the dialog behind the row. Appendix B gives the rules.

### 3.3 Three channels

| Situation | Channel |
|---|---|
| Expected refusal, for example a maximum | Returned `{ allowed: false, reason, reasons? }` |
| Incorrect call, for example a value that is not an element | Thrown `SclError` with the same variants |
| No edit produced (legacy) | `null` or `[]`, unchanged |

```ts
export class SclError extends Error {
  readonly reason: SclReasonDetails;
}
```

### 3.4 Limits that a file does not declare

The option `limitPolicy` belongs to the operation. The check function and the create function accept the same option, under the same name, in the same options object.

```ts
const options = { limitPolicy: "permit" } as const;   // one setting in the host

const check = checkAddDataSet(ln0, options);
const edits = createDataSet(ln0, options);            // same object
```

A host that sets the value is not affected by a change of default. A host that passes nothing gets the default of the installed version. D5 gives the decision on the default.

| Situation | `permit` | `refuse` |
|---|---|---|
| No `Services` element, or no service element | Allowed, `limits.scope: "unbounded"` | `capability-undeclared` |
| `max="0"` | `capability-zero` | `capability-zero` |
| `max="12"`, 12 in use | `limit-reached` | `limit-reached` |

The policy applies to one call. It never applies to a process. It has one axis: an undeclared limit. It does not change the structural, name or reference checks.

### 3.5 Order of reasons

The order is fixed. The first reason is the one that a row shows, so the order is part of the contract.

The rule for the order: **a reason that the user cannot correct in this operation comes before a reason that the user can correct here.** A message that asks the user to rename an element is wrong when the device cannot accept the element at all.

**Table 2: Order of reasons**

| Stage | Codes | Why this position |
|---|---|---|
| 1 | `target-missing`, `target-kind`, `target-invalid`, `target-detached` | There is no place for the operation. Suppression usually leaves this reason alone. |
| 2 | `capability-zero`, `capability-mode`, `capability-invalid` | The device or the file forbids the operation. The user cannot correct it in this dialog. |
| 3 | `capability-undeclared` | Only with `limitPolicy: "refuse"`. The file does not declare the capability. The user cannot correct it in this dialog. |
| 4 | `identity-name-taken`, `identity-id-taken`, `identity-instance-conflict`, `identity-already-present` | The user corrects it here: choose another name, id or instance. |
| 5 | `reference-missing`, `reference-in-use`, `reference-duplicate` | The user corrects it here, or chooses another target. |
| 6 | `limit-reached`, `limit-buffered-reached`, `limit-unbuffered-reached`, `limit-attributes-reached` | The user must free space or choose another parent. This is more work than a rename. |
| 7 | `mapping-missing`, `mapping-missing-gse`, `mapping-missing-smv` | The caller requests the communication part. The correction is work in `Communication`. |
| 8 | `restriction-mismatch`, `restriction-not-editable` | The request conflicts with the data or with the editability rules of the file. Often the answer is a different source, not a change. |

`restriction-undeclared` never causes a refusal, so it has no position.

`capability-zero` is at stage 2 for a reason. If the name is in use and GOOSE has `max="0"`, a message about the name sends the user to rename, and the next attempt fails again. The capability reason comes first because it cannot be fixed here. A zero declaration cannot occur together with a limit reason or with `capability-undeclared`, so a scope never shows two capability reasons for one service.

Two placements are open for comment:

1. `identity` before `reference`. Both are local. A rename is cheaper than the creation of a `DataSet`.
2. `limit` after `reference`. If the `DataSet` does not exist and the limit is full, both block. The limit could come first, because the creation of the `DataSet` would fail. This proposal puts the limit after the reference and before the mapping.

Rules:

1. `all: true` returns `reason` first and the other reasons in the same order. `reasons[0]` is always `reason`.
2. A rule whose precondition failed produces no reason and takes no position.
3. A host must not re-sort the list for the value of `reason`. A host can sort for display.
4. A test asserts the full sequence for a fixture with four reasons. A change of the order belongs in the release notes.

## 4. Categories of concern

The schema has four kinds of constraint: `xs:unique`, `xs:key`, `xs:keyref` and the type restrictions. IEC 61850-6 adds the capability rules and the semantic rules. Each reason code belongs to one of seven categories.

| Category | Question | Blocks the operation? |
|---|---|---|
| `target` | Is there a valid place for the element? | Always |
| `capability` | Does the device declare the service, and with which maximum? | `zero`, `mode` and `invalid` always. `undeclared` follows `limitPolicy` |
| `limit` | Is the element within the declared maximum? | Always |
| `identity` | Does another element use the same name, id or instance? | Always |
| `reference` | Does the pointer have a target, and is the target still unused? | Always |
| `mapping` | Does `Communication` cover the control block? | Only when the caller requests the part |
| `restriction` | Is the data compatible with the request? | `mismatch` and `not-editable` always. `undeclared` never |

Rules:

1. The first part of a code is its category. Example: `limit-buffered-reached`.
2. A new code needs a category, a source and a test.
3. A supervision rule uses these categories. It does not need a new category.
4. One vocabulary serves the `check*` functions and the document check.

Appendix D gives all 25 codes, their fields, their source and the rule for choosing one.

## 5. Decisions

Each decision starts with the question. It then gives the options and our preferred answer. Reply with the number and the letter.

### 5.1 Summary

**Table 3: Decisions**

| # | Question | Preferred | Cost of the other option |
|---|---|---|---|
| D1 | Add a check function, or change the create function? | Add a check function | Breaks every call site |
| D2 | One reason vocabulary, or one for each family? | One vocabulary for all families | One `switch` for each family in each host |
| D3 | Does the library return user-facing text with a refusal? | Yes, one English sentence | The host writes every message |
| D4 | Does a refusal throw, or return a result? | Return it. Throw only for an incorrect call | `try`/`catch` around a disabled button |
| D5 | Which default for an undeclared limit, and in which release? | `refuse` in 2.x, `permit` in 3.0 | Half of the sample becomes uneditable, or 2.1 carries a second behaviour change |
| D6 | What is the option called? | `limitPolicy` | `strict` promises rules that the option does not apply |
| D7 | Refuse an addition above a declared maximum, or warn? | Refuse | An edit that the device cannot accept |
| D8 | Is a missing requested part a refusal or a warning? | Refusal | A second result shape |
| D9 | Replace the names in a major release, or add new names in a minor? | New names, minor release | A behaviour change under the old names |
| D10 | How many pull requests deliver 2.1? | Three | One large review |
| D11 | Does `maxAttributes` change its type in 2.x? | No. Correct only the undeclared branch | A wrong value of `max` |
| D12 | Does the check answer `name` and `datSet`? | Yes | Two of four causes stay unexplained |
| D13 | Does `checkRemove*` ship in 2.1, and does it take `force`? | After 2.1, without `force` | A `force` dialog with no reason |
| D14 | When does `create*` read the report options? | `check*` in 2.1, `create*` in 3.0 | `check*` and `create*` disagree on `maxBuf` |
| D15 | Does the report limit count blocks or instances, and when? | Blocks, in 2.1 | 72 wrong refusals in 24 files |

### 5.2 D1. API shape

**Question:** Should the library add a check function beside each create function, or make the create function return both the result and the edits?

- **A.** One check function beside each create function.
- **B.** One return value for each operation. `createX` returns `{ ok, edits }` or `{ ok: false, reason }`.
- **C.** One function name with overloads.

Option A keeps the create function as the only builder of an edit. Option B breaks every call site and hides a partial edit set. Option C gives one name two behaviours.

**Preferred answer: A.**

### 5.3 D2. Reason vocabulary

**Question:** Should all element families share one reason vocabulary, or should each family have its own?

- **A.** One vocabulary for all element families.
- **B.** One enum for each family.
- **C.** Global codes for the structural problems and family codes for the limits.

Option A needs one `switch` in the host. Option B needs one `switch` for each family. Option C needs two vocabularies.

**Preferred answer: A.**

### 5.4 D3. Text

**Question:** Should a refusal contain user-facing text, and if yes, in which form?

- **A.** No text in the library. The host makes the message from the fields.
- **B.** A `lang` parameter and translated sentences in the library.
- **C.** One English sentence in `reasonText`. The library builds the sentence from the same fields. No `lang`.

Option C gives a fallback that needs no work in the host. It keeps one source for the sentence. A host can still write its own text. Option B adds a translation system to a library that returns a diff.

**Preferred answer: C.** This answer changed from A during the review. The objection from Christian Dinkel was against translation in the library. One English sentence is not a translation system, and no locale code enters the API.

### 5.5 D4. Throwing

**Question:** Should a refusal throw an error, or return a result? When should the library throw?

- **A.** Return a refusal. Throw `SclError` only for an incorrect call.
- **B.** Never throw.
- **C.** Throw for each failure.

**Preferred answer: A.**

### 5.6 D5. Default for an undeclared limit

**Question:** Which default applies to a limit that the file does not declare, and in which release does the default change?

The default decides the result for a caller that passes no `limitPolicy`. The evidence sets the target. The schema makes `Services` optional, and 58 of 120 files use a service that they do not declare. A `refuse` default blocks edits in half of the sample. The target default is `permit`.

The options differ in **when** that default applies.

| Option | 2.x | 3.0 | Behaviour changes in 2.1 |
|---|---|---|---|
| **A.** `permit` from 2.1 | `permit` | `permit` | Two: the counting rule and a new permission |
| **B.** Change at the major version | `refuse` | `permit` | One: the counting rule |
| **C.** `refuse` in all versions | `refuse` | `refuse` | One: the counting rule. `permit` is always opt-in. |

- **A.** One default in all versions, from 2.1.
- **B.** `refuse` in 2.x, `permit` in 3.0.
- **C.** `refuse` in all versions.

**Preferred answer: B.** Three reasons:

1. The target default is `permit`, because the file states its own capability and the schema does not require `Services`.
2. A change of default is a behaviour change. Version 2.1 must carry one behaviour change only, the counting fix in D15. Option A puts a second change into the same minor release. In a file that shows a disabled button today, the button starts to work, with no change in the host.
3. A caller that sets `limitPolicy` is not affected by the change. A host that prepares files for a known device keeps `refuse`. A host that edits any file sets `permit` one time, in one place.

Option C keeps the safest default but contradicts the schema and the measurement. It also makes the option mandatory knowledge for every plugin author who opens a file without `Services`.

### 5.7 D6. Name of the policy option

**Question:** What should the option for an undeclared limit be called?

- **A.** `limitPolicy: "permit" | "refuse"`.
- **B.** `strict: boolean`.
- **C.** `undeclaredLimit: "permit" | "refuse"`.

**Preferred answer: A.** The name shows the one item that the option changes.

### 5.8 D7. Declared maximum

**Question:** Should the library refuse an addition above a declared maximum, or permit it and report a warning?

- **A.** Refuse an addition above a declared maximum.
- **B.** Permit it and report a warning.

**Preferred answer: A.**

### 5.9 D8. Partial result

**Question:** When the caller requests a communication part and the file cannot provide it, should the result be a refusal or a warning?

A `GSEControl` request with a `gse` option and no `ConnectedAP` produces the control block only.

- **A.** The check answers for the requested scope. A requested part that is not possible causes a refusal.
- **B.** Option A plus an `incomplete` field on a permitted result.
- **C.** A third value in `allowed`.

**Preferred answer: A.** Option B stays available for a host that wants a warning.

### 5.10 D9. Release vehicle

**Question:** Should the new API replace the existing function names in a major release, or arrive under new names in a minor release?

- **A.** 3.0.0. Correct the rules under the existing names.
- **B.** 2.1.0. Add new `check*` names. Keep the old names, deprecate them and remove them in 3.0.

**Preferred answer: B.** A new name makes the addition additive. The one behaviour change is D15, and it is a fix.

### 5.11 D10. Pull requests

**Question:** How many pull requests should deliver 2.1, and what does each one contain?

- **A.** One pull request: error model, six checks, wrappers and README.
- **B.** Three pull requests: the counting fix; the error model and the checks; the removal of the dead file.
- **C.** One pull request for each element family.

**Preferred answer: B.** The counting fix is a behaviour change and needs a separate review. The six checks are mechanical after the vocabulary is agreed. Option C gives six review cycles for one shape.

### 5.12 D11. `maxAttributes`

**Question:** Should the exported `maxAttributes` change its return type in 2.x, and what should its undeclared branch return?

- **A.** Keep the `{max: number}` type. The undeclared branch returns `-1` with `scope: "unbounded"`, not the current count.
- **B.** Change the type to `{max?: number}` now.

**Preferred answer: A.** Option B changes the return type of an exported function in a minor release.

### 5.13 D12. Does the check read `name` and `datSet`?

**Question:** Should a check answer only the limits, or also the name and the `datSet` reference?

- **A.** Yes. Structure, name, reference and limit.
- **B.** Limits only.

**Preferred answer: A.**

### 5.14 D13. `checkRemove*` in this release

**Question:** Should `checkRemove*` ship in 2.1, and should it accept a `force` parameter?

- **A.** After 2.1. The check has no `force` parameter. `allowed: false` with `reference-in-use` means that the user must confirm.
- **B.** `removeDataType` only.
- **C.** All remove functions.

**Preferred answer: A.** A check that takes `force` has nothing to report. Appendix E gives the shape.

### 5.15 D14. Report check options

**Question:** When should `createReportControl` read the options that `checkAddReportControl` already reads?

`createReportControl` calls `canAddReportControl(anyLn)` with no options. It ignores `buffered` and `instances`.

- **A.** `check*` reads the options in 2.1. `create*` reads them in 3.0.
- **B.** Both read them in 2.1.
- **C.** Both read them in 3.0.

**Preferred answer: A.** The difference is small: an unbuffered create when `maxBuf` is full. Appendix C lists the difference.

### 5.16 D15. Counting rule for `ConfReportControl`

**Question:** Should a report limit count control blocks or client instances, and in which release should the rule change?

- **A.** Count `ReportControl` elements against `max` and `maxBuf`, in 2.1, for `check*`, `can*` and `create*`.
- **B.** Count `RptEnabled@max` instances, as the library does today.
- **C.** Count elements by default and give the host an option for instances.

**Preferred answer: A.** This change is a fix, not a policy. It removes refusals and adds none. Appendix C gives the counts.

## 6. Release plan

| Release | Content | Behaviour change |
|---|---|---|
| 2.1.0 | Counting fix and internal `servicesLimits()`; error model and six `check*`; `limitPolicy` on the create functions; `@deprecated` on `canAddFCDA` and `canInstantiateSubscriptionSupervision`; README section; removal of the dead file | Report limits count blocks. `limitPolicy` defaults to `refuse`. |
| 3.0.0 | `limitPolicy` defaults to `permit` in both functions (D5); `create*` reads the report options (D14); removal of the deprecated functions; `maxAttributes` returns `{max?: number}` | A file that declares no limit becomes editable |

The four `canAdd*` functions that `index.ts` does not export get no deprecation. A plugin cannot import them. They are removed in 3.0, when the new functions are available.

Compatibility rules:

1. `null` and `[]` keep one meaning: no edit.
2. No existing function starts to throw.
3. No existing type changes in 2.x.
4. A host must not mix generations for one control. `check*` with `create*` is supported. `check*` with `can*` is not.

## Appendix A. Evidence: method and full table

**Table 4: All conditions in the sample**

| Condition | Count | Files |
|---|---|---|
| IED with no `Services` element | 83 of 676 | — |
| IED that uses a service that it does not declare | `SMVsc` 163, `GOOSE` 24, `ConfDataSet` 29, `ConfReportControl` 5 | 58 of 120 |
| Service declared with `max="0"` | `GOOSE` 44, `SMVsc` 12 | — |
| `SupSubscription` with `maxGo` or `maxSv` equal to 0 | 254 of 397 | — |
| Scope above `ConfReportControl@max`, instances counted | 72 | 24 |
| Scope above `ConfReportControl@max`, blocks counted | 6 | 2 |
| Scope above `GOOSE@max` | 16 | — |
| Scope above `ConfDataSet@max` | 0 | — |
| Control block with no `ConnectedAP` | `GSE` 31, `SMV` 55 | 18 |
| `GSEControl` against `GSE` elements | 1,579 against 1,265 | — |
| `SampledValueControl` against `SMV` elements | 403 against 337 | — |
| `lnType` without a `LNodeType` | 27 ids, 69 uses | 17 |
| `datSet` without a `DataSet` | 9 | 8 |
| `iedName` without an `IED` | 43 ids | 4 |
| DataTypeTemplates reference without a target | 12 | 3 |
| Duplicate `ConnectedAP` | 22 | 6 |
| Duplicate `LDevice inst` in one `IED` | 0 | — |
| `ExtRef` with `pDO` | 9,294 of 40,321 | 49 of 103 have none |
| `Private` element | 76,612 | 102 of 120 |
| Service element without `max` | 1 | 1 |

Method:

- Population: 716 files with the extension `.scd`, `.cid` or `.icd`, from 20 kB to 60 MB, in three local collections.
- Sample: 120 files at a fixed interval from the sorted list, plus the four largest files.
- Schema: `IEC_61850-6.2018.SCL.2007B4.full`, including `xs:unique`, `xs:key` and `xs:keyref`.
- Editions: 117 files with `version="2007"`. 3 files have no `version` attribute.
- Reader: one pass. The reader does not change a file.
- Size of the sample: 676 IED, 9,986 `ReportControl`, 1,579 `GSEControl`, 403 `SampledValueControl`, 3,116 `DataSet`, 63,323 `FCDA`, 40,321 `ExtRef`.

## Appendix B. All reasons and aggregation

`check*` returns the first reason. The option `all: true` returns each reason that is defined for the same options. Both use one walker. For this reason, `reason` is always `reasons[0]`.

### B.1 Independent reasons

```ts
checkAddReportControl(ln0, { all: true, rpt: { name: "rptA", datSet: "DS1" } })
// reasons:
//   identity-name-taken   the name "rptA" is in use
//   reference-missing     the DataSet "DS1" does not exist
//   limit-reached         current 15, max 15
```

The user sees three remedies in one dialog. With the first reason only, the user changes the name and gets a second refusal.

`capability-zero` is the important case in `checkAddGSEControl`. It tells the user that this IED cannot accept the element. The first reason alone does not show this.

### B.2 Aggregation

The library collects repeated reasons into one reason. The reason contains the complete set of affected elements. The sentence contains the count.

```ts
checkLNodeTypeUpdate(updated, doc, { all: true })
// reasons:
//   reference-in-use  kind "fcda",      affected: [412 FCDA]
//   reference-in-use  kind "extref",    affected: [87 ExtRef]
//   reference-in-use  kind "sourceref", affected: [6 SourceRef]
```

```ts
export type ReferenceKind = "fcda" | "extref" | "sourceref";

export type RemovedData = {
  path: string;                            // "Pos.stVal"
  tag: "DO" | "SDO" | "DA" | "BDA";
};

export type ReferenceInUse = {
  key: "reference-in-use";
  tag: "LNodeType" | "DOType" | "DAType";
  kind: ReferenceKind;
  removed: RemovedData[];
  affected: Element[];
  reasonText: string;
};
```

The library makes one reason for each reference kind. It does not make one reason for each reference. `affected` is complete. The count is `affected.length`. The library does not build 412 location strings for a message that needs only the number.

`checkLNodeTypeUpdate` is a separate issue. It needs no new category. It uses `reference-in-use` with a `kind` field.

### B.3 Suppression

A rule that cannot start does not make a reason.

- No `LN0` gives `target-missing` only. It does not give the name, reference and limit reasons.
- `max="0"` gives `capability-zero` only. It does not also give `limit-reached`.
- A wrong tag gives `target-kind` only.
- No `Services` with `refuse` gives one `capability-undeclared`. It does not give four limit reasons.

### B.4 `anyOf` operations

The question "can this IED accept a `DataSet`?" is a search through the `LDevice` elements. The answer is yes when one device has space.

```ts
// failure: one reason, not one reason for each device
{ key: "limit-reached", tag: "DataSet", scope: "IED",
  current: 156, max: 12, affected: [13 LDevice], reasonText:
  "All 13 logical devices have reached ConfDataSet@max (12)." }
```

13 reasons would report a failure for an operation that succeeds when one device has space. They would also show 13 remedies that do not exist.

### B.5 Where to use `all: true`

| Operation | All reasons? | Reason |
|---|---|---|
| Add a `DataSet`, `GSEControl`, `ReportControl` or `SampledValueControl` | Yes | Three or four independent remedies |
| Instantiate a supervision | Yes | Four independent remedies |
| `checkLNodeTypeUpdate` | Yes, the main use | Flat reasons with aggregation |
| Add a `DataSet` to an `IED` | One collected reason | A search, not a list |
| `subscribe` with more than one connection | No | One result for each connection |

## Appendix C. Implementation notes

### C.1 Counting rules

| Attribute | Counted as |
|---|---|
| `ConfReportControl@max` | `ReportControl` elements in the scope |
| `ConfReportControl@maxBuf` | `ReportControl` elements with `buffered="true"` |
| `ConfDataSet@max` | `DataSet` elements in each `LDevice` |
| `ConfDataSet@maxAttributes` | `FCDA` elements in each `DataSet` |
| `GOOSE@max` | `GSEControl` elements in the scope |
| `SMVsc@max` | `SampledValueControl` elements in the scope |

`RptEnabled@max` counts the client instances of one block. It does not add a block to the logical node. The schema does not limit it through `Services`.

`numberReportControlInstances` becomes dead code. Delete it with its test. `maxReportControl` is internal. `servicesLimits()` replaces it.

### C.2 The one difference in 2.x

| Behaviour | 2.x | 3.0 |
|---|---|---|
| Counting rule | blocks, in both functions | blocks |
| `limitPolicy` | accepted by both functions. Default `refuse`. | accepted by both functions. Default `permit`. |
| Report options | `check*` reads them. `create*` ignores them. | both read them |

The last row is the only difference between the two functions. It affects one case: an unbuffered create when `maxBuf` is full. `limitPolicy` is not a difference: the caller passes one options object to both functions.

### C.3 Functions that can disagree

| Cause | Countermeasure |
|---|---|
| Different option shapes | One normalised options type |
| Options lost before the check | The create function passes the same options |
| Different target resolution | One `targetFor(parent)` helper |
| The caller's options are changed | Copy the options before a change |
| The document changes between the calls | The create function checks again. The check is advice. |

The test that keeps the relation:

```ts
expect(createReportControl(ln, options) === null)
  .to.equal(!checkAddReportControl(ln, options).allowed);
```

### C.4 Performance

A check reads. It does not create an element, start a generator or clone a node. The expensive work stays in the create function.

1. Select the smallest scope. Use `:scope` selectors.
2. Do not allocate, generate or clone in a check.
3. Run one check for each create call.
4. Do not cache. The DOM has no version number for the cache key.
5. Run the check one time for each render. Do not run it for each mouse movement.

### C.5 Caller protocol

`createX` calls `checkX` one time. A caller does not call `checkX` before `createX`. A caller that needs a reason or a disabled button calls `checkX` and discards the result after the next change. No function accepts a check result as an argument.

### C.6 Text rules

- The factory builds the sentence from the fields. Write the sentence one time only.
- Use British English, full stops and no abbreviations.
- Use one small helper for English plurals. Do not use `Intl`.
- The wording is not API. The codes are stable, but the prose can change in a minor release. A test in a plugin must check the fields, not the sentence.
- Do not add an override hook and do not add `lang`. A host that wants another language ignores `reasonText`.

### C.7 Tests

- `checkX(...).allowed === canX(...)` for each family and each test file.
- `createX(...) === null` or `[]` is equal to `!checkX(...).allowed`.
- One test for each reason code. Check the exact fields.
- One test for each family with no `Services`, and the same test with `limitPolicy: "refuse"`.
- One test for `max="0"`: `capability-zero` in both policies.
- One test for the counting rule: one block with `RptEnabled max="20"` is within `max="4"`.
- One test for `all: true`: `reason` is equal to `reasons[0]`.
- One test for the order in Section 3.5: a fixture with four reasons returns them in the documented sequence.
- One test with one options object for both calls, in both orders.
- One performance test on a large test file.

## Appendix D. Reason codes

```ts
type TargetMissing = { key: "target-missing"; tag: string; reasonText: string };
type LimitReached = { key: "limit-reached"; tag: string; scope: LimitInfo["scope"];
                      current: number; max: number; affected: Element[]; reasonText: string };
// ... one variant for each code below
export type SclReasonDetails = TargetMissing | LimitReached | /* ... */;
export type SclReason = SclReasonDetails["key"];
```

A variant has no optional fields. A reason that is not a set has `affected: []`.

| Code | Category | Fields | Source |
|---|---|---|---|
| `target-missing` | `target` | `tag` | content model |
| `target-kind` | `target` | `tag`, `expected` | content model |
| `target-detached` | `target` | `tag` | policy |
| `target-invalid` | `target` | `tag` | content model |
| `capability-undeclared` | `capability` | `tag`, `service`, `scope` | policy |
| `capability-zero` | `capability` | `tag`, `service`, `scope` | `tServiceWithMax` |
| `capability-mode` | `capability` | `tag`, `service`, `mode` | `tServiceConfReportControl` |
| `capability-invalid` | `capability` | `tag`, `service`, `value` | `tServiceWithMax` |
| `limit-reached` | `limit` | `tag`, `scope`, `current`, `max`, `affected` | `@max` |
| `limit-buffered-reached` | `limit` | `tag`, `scope`, `buffered`, `maxBuffered`, `affected` | `@maxBuf` |
| `limit-unbuffered-reached` | `limit` | `tag`, `scope`, `unbuffered`, `max`, `maxBuffered`, `affected` | `@max` and `@maxBuf` |
| `limit-attributes-reached` | `limit` | `tag`, `scope`, `current`, `max`, `affected` | `@maxAttributes` |
| `identity-name-taken` | `identity` | `tag`, `name`, `conflict` | `uniqueReportControlInLN0` |
| `identity-id-taken` | `identity` | `tag`, `id`, `conflict` | `uniqueDTT_ID` |
| `identity-already-present` | `identity` | `tag`, `controlBlock` | policy |
| `identity-instance-conflict` | `identity` | `tag`, `inst`, `conflict` | `uniqueLNInLDevice` |
| `reference-missing` | `reference` | `tag`, `kind`, `name` | `ref2DataSetGSELN0` |
| `reference-in-use` | `reference` | `tag`, `kind`, `removed`, `affected` | `ref2DOType` |
| `reference-duplicate` | `reference` | `tag`, `iedName`, `apName` | `uniqueConnectedAP` |
| `mapping-missing` | `mapping` | `tag`, `iedName`, `apName` | `Communication` |
| `mapping-missing-gse` | `mapping` | `tag`, `ldInst`, `cbName` | `Communication` |
| `mapping-missing-smv` | `mapping` | `tag`, `ldInst`, `cbName` | `Communication` |
| `restriction-mismatch` | `restriction` | `tag`, `expected`, `actual` | IEC 61850-7-3, IEC 61850-7-4 |
| `restriction-undeclared` | `restriction` | `tag` | policy |
| `restriction-not-editable` | `restriction` | `tag`, `attribute` | IEC 61850-6 |

### D.1 Choosing a code

The table above gives the fields. This section gives the rule for each code: when to return it, and when another code is correct.

Three rules decide most cases:

1. **Name the constraint, not the symptom.** "The name is in use" is `identity-name-taken`. "It did not work" is not a code.
2. **A code belongs to the check that failed, not to the document.** A dangling `iedName` in a different IED is a `reference-missing` finding. It is not a reason to refuse this edit.
3. **One code for one fact.** If two independent items block the operation, return two reasons with `all: true`, or the first reason with `check*`.

#### `target` — there is no place for the element

- **`target-missing`** — the element that the operation needs does not exist. No `LN0` under the parent, no `LDevice`, no `LGOS` for a fixed target, no `ConnectedAP`. Use it when the container is absent. Do not use it when a pointer inside the parent has no target; that is `reference-missing`.
- **`target-kind`** — the element exists but has the wrong tag. A `DataSet` passed to `updateReportControl`, or a `SubNetwork` used as the parent of a control block. Use it when the tag is wrong. Do not use it when the tag is correct and the element is incomplete.
- **`target-invalid`** — the element exists and has the correct tag, but it cannot serve the purpose. A `Private` element as a parent, or an `LN` that is not under an `IED` when a limit must be read. Use it for a structural problem that is not a tag mismatch.
- **`target-detached`** — the element is not in a document. This is a caller error. The library throws `SclError` with this code and does not return a result.

#### `capability` — what the file says about the device

- **`capability-undeclared`** — the file has no `Services` element, or no service element in it. The policy decides if this blocks. Use it only when the declaration is absent.
- **`capability-zero`** — the file declares the service with `max="0"`. The device says that it has none. Use it when the declared value is zero. Do not use `limit-reached` for this case.
- **`capability-mode`** — the service has a limit, but a mode flag excludes the requested kind. Example: `bufMode="unbuffered"` when the caller adds a buffered report. Use it when a value other than `max` excludes the operation.
- **`capability-invalid`** — the service element exists, but `max` is absent or not a number. The file breaks the schema. Use it when the library cannot read a usable limit. Do not use "unbounded" as a fallback: the file is wrong, not permissive.

#### `limit` — a declared maximum

- **`limit-reached`** — the total count would exceed `max`. Use it for the total only.
- **`limit-buffered-reached`** — the buffered count would exceed `maxBuf`. Use it only when the file declares `maxBuf` and the element is buffered.
- **`limit-unbuffered-reached`** — the unbuffered count would exceed the space that `max` leaves after `maxBuf`. Use it only when the element is unbuffered and the file declares `maxBuf`.
- **`limit-attributes-reached`** — a `DataSet` would exceed `maxAttributes`. Use it for the attribute count in one `DataSet`, not for the number of `DataSet` elements.

Do not use a `limit` code when nothing is declared or when the declared value is zero. Those are `capability` codes. The host shows a different message for each.

#### `identity` — two elements claim the same item

- **`identity-name-taken`** — another element in the same scope uses the name. The scope is the one that the schema defines: `ReportControl` names are unique in an `LN0`, and `DataSet` names are unique in an `LN` or `LN0`. Use it for a clash in the scope. A name in a different `LN0` is not a clash.
- **`identity-id-taken`** — a DataTypeTemplates id is already in use. Use it for `LNodeType`, `DOType`, `DAType` and `EnumType` ids.
- **`identity-already-present`** — the item that the caller wants to add is already there. The control block already has a supervision, or the `ExtRef` is already subscribed. Use it when the operation would duplicate a relationship, not a name.
- **`identity-instance-conflict`** — the requested instance is in use. The combination of `inst`, `lnClass` and `prefix` already exists, or a fixed supervision instance is taken. Use it when the clash is an instance, not a name.

#### `reference` — a pointer needs a target

- **`reference-missing`** — a pointer that the operation uses has no target. A `datSet` attribute with no `DataSet`, an `lnType` with no `LNodeType`, an `FCDA` `ldInst` with no `LDevice`, or a `ClientLN` `iedName` with no `IED`. Use it for the operation that creates the pointer, and for a finding in the document.
- **`reference-in-use`** — the target still has users, so a removal or a change would break them. `removeDataType` and `checkLNodeTypeUpdate` use it with `affected` and `kind`. Use it when the blocker is an existing user of the element that the caller wants to remove or change.
- **`reference-duplicate`** — the file contains two elements that claim the same key. Example: two `ConnectedAP` elements with the same `iedName` and `apName` in different subnets. Use it for a finding in the document. When the caller adds the second element, `identity-*` is the correct code.

#### `mapping` — the communication section does not cover the block

- **`mapping-missing`** — no `ConnectedAP` exists for the IED and AccessPoint of the control block.
- **`mapping-missing-gse`** — the `ConnectedAP` exists, but it has no `GSE` for this `ldInst` and `cbName`.
- **`mapping-missing-smv`** — the same, for `SMV`.

Use a `mapping` code only when the caller requests the communication part. If the caller adds a control block and does not request `GSE` or `SMV`, nothing is missing. The host can still show a warning with the same code on a permitted result.

#### `restriction` — the data does not fit the request

- **`restriction-mismatch`** — the data exists but is not compatible. The `ExtRef` restricts `pDO`, `pDA`, `pLN` or `pServT`, and the `FCDA` does not meet the restriction. Use it when both sides are declared and they disagree.
- **`restriction-undeclared`** — the element gives no restriction data, so the library cannot use the rule. Example: an `ExtRef` without `pDO`, which is 77% of the elements in the sample. Use it as information only. This code never blocks.
- **`restriction-not-editable`** — the file forbids the change although the schema permits it. `valKind` is neither `Conf` nor `RO`, `valImport` is not true, or a supervision `LN` has no creation marker. Use it when the schema permits the edit but the file does not.

#### Common mistakes

1. `limit-reached` for `max="0"`. Use `capability-zero`.
2. `capability-undeclared` when the service element exists and only `max` is absent. Use `capability-invalid`.
3. `target-missing` when the parent exists but has the wrong tag. Use `target-kind`.
4. `reference-missing` for a name clash. Use `identity-name-taken`.
5. `restriction-undeclared` as a refusal. It never blocks.
6. `mapping-missing` when the caller did not request the communication part.
7. Two limit reasons for one cause. A `maxBuf` breach on a buffered element is `limit-buffered-reached` only.

## Appendix E. Checks after 2.1

### E.1 `checkRemoveDataType` and `checkRemoveSupervision`

These functions have no `force` parameter. A refusal with `reference-in-use` means that the user must confirm. After the confirmation, the host calls `removeDataType(remove, { force: true })`.

| Rule | Reason |
|---|---|
| Not a data type or a supervision `Val` | `target-kind`, `reference-missing` |
| Still referenced | `reference-in-use` with `kind` and `affected` |
| `LGOS` or `LSVS` without a creation marker | `restriction-not-editable` |
| Fixed instance in use | `identity-instance-conflict` |

`removeDataType` also removes types that become unused. This is a result of the operation, not a reason. It stays out of the result. The host can compare the document after the edit.

### E.2 `checkLNodeTypeUpdate`

This is a separate issue. The signature follows the edit function:

```ts
checkLNodeTypeUpdate(lNodeType: Element, targetDoc: XMLDocument, options?: { all?: boolean })
```

It uses `reference-in-use` with `kind: "fcda" | "extref" | "sourceref"` and aggregation. It needs no new category.

## Appendix F. Example implementation: `checkAddDataSet`

This appendix gives one implementation. It uses the example from Harald Brabenetz: "The maximum number of DataSets (12) has been reached."

F.1 gives the sketch. F.2 to F.9 give the detail. The code is illustrative. Names can change in the implementation pull requests. The shape, the order and the texts follow Sections 3 to 5.

### F.1 Sketch

```ts
// 1. One variant for one reason. One factory builds the sentence from the fields.
type LimitReached = {
  key: "limit-reached";
  tag: "DataSet";
  current: number;
  max: number;
  affected: Element[];
  reasonText: string;
};

const limitReached = (current: number, max: number): LimitReached => ({
  key: "limit-reached", tag: "DataSet", current, max, affected: [],
  reasonText: `The maximum number of DataSets (${current} of ${max}) has been reached.`,
});

// 2. One walker. The stages follow Section 3.5. A rule with no precondition gives no reason.
function walk(parent, options, stopAtFirst): SclReasonDetails[] {
  const ln = targetFor(parent);
  if (!ln) return [targetMissing("DataSet")];              // stage 1
  if (max === 0) return [capabilityZero("DataSet")];       // stage 2, not a limit
  // stage 3 capability-undeclared, stage 4 identity, stage 6 limit
  // ... each rule pushes its reason, then returns when stopAtFirst is true
}

// 3. The public function: one reason, or every reason when the caller asks.
checkAddDataSet(parent, options)
// { allowed: true } | { allowed: false, reason, reasons? }

// 4. The create function: one check, no second implementation of a rule.
createDataSet(parent, options)
// checkAddDataSet(parent, options) refused ? null : edit
```

**What the author must remember**

1. One variant for each reason code. No optional fields inside a variant. A reason that is not a set has `affected: []`.
2. One factory for each variant. The factory builds the sentence from the same fields that the host reads. British English, full stop, plain numbers, no `Intl`.
3. `reason` is always `reasons[0]`. `reasons` is a non-empty tuple and is present only when the caller sets `all: true` and a second reason exists.
4. The order follows Section 3.5: target, capability-zero or mode or invalid, capability-undeclared, identity, reference, limit, mapping, restriction.
5. Suppression: a rule whose precondition failed gives no reason. A zero declaration excludes a limit reason. No target excludes every later stage.
6. `limitPolicy` applies to an undeclared limit only. It never applies to `max="0"`. The default is `refuse` in 2.x.
7. `max="0"` gives `capability-zero`. A missing attribute gives `capability-invalid`. A missing service element gives `capability-undeclared`.
8. Count blocks, not `RptEnabled@max` instances. Appendix C.1 gives each counting rule.
9. The create function calls the check function one time and returns `null` or `[]` when the check refuses. No rule is written twice.
10. A check is read-only: no `createElement`, no generator, no clone, one pass.
11. Every code has a source comment and a test. Every family has the equivalence test `createX === null ⟺ !checkX.allowed`.
12. The paragraph text is not API. The library test asserts one exact sentence for each code. A host test asserts fields.
13. A host must not mix `check*` with `can*` for one control. `check*` with `create*` is the supported pair.
14. A requested part that is not possible is a refusal. `incomplete` appears only when the host asks for it.

### F.2 The variants and the factories

```ts
// foundation/reasons.ts
import { LimitInfo, SclReasonDetails } from "./errors.js";

export type LimitReached = {
  key: "limit-reached";
  tag: "DataSet";
  scope: LimitInfo["scope"];
  current: number;
  max: number;
  affected: Element[];          // empty: this reason is not a set
  reasonText: string;
};

export type CapabilityZero = {
  key: "capability-zero";
  tag: "DataSet";
  service: "ConfDataSet";
  scope: LimitInfo["scope"];
  reasonText: string;
};

export type CapabilityUndeclared = {
  key: "capability-undeclared";
  tag: "DataSet";
  service: "ConfDataSet";
  scope: LimitInfo["scope"];
  reasonText: string;
};

export type NameTaken = {
  key: "identity-name-taken";
  tag: "DataSet";
  name: string;
  conflict: Element;
  reasonText: string;
};

/** One factory for each variant. The factory builds the sentence from the fields. */
export function limitReached(
  tag: "DataSet",
  scope: LimitInfo["scope"],
  current: number,
  max: number,
): LimitReached {
  return {
    key: "limit-reached",
    tag,
    scope,
    current,
    max,
    affected: [],
    reasonText: `The maximum number of ${tag} instances (${current} of ${max}) has been reached.`,
  };
}

export function capabilityZero(tag: "DataSet"): CapabilityZero {
  return {
    key: "capability-zero",
    tag,
    service: "ConfDataSet",
    scope: "unbounded",
    reasonText: `The file declares that this device does not support ${tag} elements.`,
  };
}

export function capabilityUndeclared(tag: "DataSet"): CapabilityUndeclared {
  return {
    key: "capability-undeclared",
    tag,
    service: "ConfDataSet",
    scope: "unbounded",
    reasonText: `The file does not declare a maximum for ${tag} elements.`,
  };
}

export function nameTaken(
  tag: "DataSet",
  name: string,
  conflict: Element,
): NameTaken {
  return {
    key: "identity-name-taken",
    tag,
    name,
    conflict,
    reasonText: `The name ${name} is already used by another ${tag}.`,
  };
}
```

### F.3 The helpers

```ts
// tDataSet/checkAddDataSet.ts
import { Insert } from "@openscd/oscd-api";
import { CheckResult } from "../foundation/errors.js";
import { servicesLimits } from "../tServices/servicesLimits.js";

/** @returns The LN or LN0 that receives the DataSet */
function targetFor(parent: Element): Element | undefined {
  if (parent.tagName === "LN0" || parent.tagName === "LN") return parent;
  return parent.querySelector("LN0, LN") ?? undefined;
}

/** @returns The DataSet elements in the LDevice of `ln` */
function dataSetCount(ln: Element): number {
  const ldevice = ln.closest("LDevice");
  if (!ldevice) return 0;
  return ldevice.querySelectorAll(":scope > LN0 > DataSet, :scope > LN > DataSet")
    .length;
}
```

### F.4 The walker

The walker collects the reasons in the order of Section 3.5. It stops after the first reason when `stopAtFirst` is true.

```ts
export type AddDataSetOptions = {
  attributes?: { name?: string };
  limitPolicy?: "permit" | "refuse";
  all?: boolean;
};

function walk(
  parent: Element,
  options: AddDataSetOptions,
  stopAtFirst: boolean,
): SclReasonDetails[] {
  const policy = options.limitPolicy ?? "refuse";
  const reasons: SclReasonDetails[] = [];

  // Stage 1: target
  const ln = targetFor(parent);
  if (!ln) return [targetMissing("DataSet")];

  const { max } = servicesLimits(ln, "ConfDataSet");
  const name = options.attributes?.name;
  const current = dataSetCount(ln);

  // Stage 2 and 3: capability
  if (max === 0) reasons.push(capabilityZero("DataSet"));
  else if (max === undefined && policy === "refuse")
    reasons.push(capabilityUndeclared("DataSet"));
  if (stopAtFirst && reasons.length) return reasons;

  // Stage 4: identity
  const conflict = name
    ? ln.querySelector(`:scope > DataSet[name="${name}"]`)
    : null;
  if (conflict) reasons.push(nameTaken("DataSet", name!, conflict));
  if (stopAtFirst && reasons.length) return reasons;

  // Stage 6: limit
  if (max !== undefined && max > 0 && current + 1 > max)
    reasons.push(limitReached("DataSet", "LDevice", current, max));

  return reasons;
}
```

A `max="0"` declaration returns `capability-zero` only. The limit stage is skipped, because a zero declaration cannot be exceeded.

### F.5 The public function

```ts
export function checkAddDataSet(
  parent: Element,
  options: AddDataSetOptions = {},
): CheckResult {
  const reasons = walk(parent, options, !options.all);

  if (reasons.length === 0) return { allowed: true };
  const [reason, ...rest] = reasons as [SclReasonDetails, ...SclReasonDetails[]];

  return {
    allowed: false,
    reason,
    ...(options.all && rest.length > 0 ? { reasons: [reason, ...rest] } : {}),
  };
}
```

`reason` is always `reasons[0]`. The `reasons` field is present only when the caller asks for it and a second reason exists.

### F.6 The create function

The create function uses the check function. It has no second implementation of the rules.

```ts
export function createDataSet(
  parent: Element,
  options: AddDataSetOptions = {},
): Insert | null {
  const check = checkAddDataSet(parent, options);
  if (!check.allowed) return null;

  const ln = targetFor(parent)!;
  const dataSet = createElement(ln.ownerDocument, "DataSet", {
    name: options.attributes?.name ?? uniqueElementName(ln, "DataSet"),
  });

  return { parent: ln, node: dataSet, reference: getReference(ln, "DataSet") };
}
```

### F.7 Tests

```ts
it("gives the sentence for a reached maximum", () => {
  // 12 DataSet elements in the LDevice, ConfDataSet max="12"
  const check = checkAddDataSet(ln0);

  expect(check.allowed).to.equal(false);
  if (check.allowed) return;

  expect(check.reason.key).to.equal("limit-reached");
  expect(check.reason).to.include({ current: 12, max: 12 });
  expect(check.reason.reasonText).to.equal(
    "The maximum number of DataSets (12 of 12) has been reached.",
  );
});

it("permits an undeclared maximum only with permit", () => {
  // No Services element in the IED
  expect(checkAddDataSet(ln0).allowed).to.equal(false);
  expect(checkAddDataSet(ln0, { limitPolicy: "permit" }).allowed).to.equal(true);
});

it("returns every reason when the caller asks for them", () => {
  // name in use and maximum reached
  const check = checkAddDataSet(ln0, { all: true, attributes: { name: "DS1" } });
  expect(check.allowed).to.equal(false);
  if (check.allowed) return;

  expect(check.reasons?.map((r) => r.key)).to.deep.equal([
    "identity-name-taken",
    "limit-reached",
  ]);
});

it("returns null from createDataSet exactly when the check refuses", () => {
  expect(createDataSet(ln0) === null).to.equal(!checkAddDataSet(ln0).allowed);
});
```

### F.8 The host

```ts
const options = { limitPolicy: "permit" } as const;
const check = checkAddDataSet(ln0, options);

addButton.disabled = !check.allowed;
addButton.title = check.allowed ? "" : check.reason.reasonText;
// "The maximum number of DataSets (12 of 12) has been reached."
```

### F.9 What the other families copy

1. The same four parts: reasons and factories, helpers, walker with stages, public function with `all`.
2. The same order from Section 3.5. Each stage returns early only when `stopAtFirst` is true.
3. One factory for each variant. The sentence uses the fields of the variant.
4. The create function delegates to the check function, always.

Two families need more work than `DataSet`:

- `ReportControl` needs the counting rule of Appendix C.1 and the buffered and unbuffered stages.
- `SubscriptionSupervision` needs the five existing predicates as separate reasons.
