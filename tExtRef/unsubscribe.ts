import { Remove, Update } from "../foundation/utils.js";

import { removeInputs } from "../tInputs/removeInputs.js";
import { removeSubscriptionSupervision } from "../tLN/removeSubscriptionSupervision.js";

/**
 * Remove link between sending IED data to receiving IED external
 * references - unsubscribing.
 * ```md
 * 1. Unsubscribes external references itself:
 * -Update `ExtRef` in case later binging is used (existing `intAddr` attribute)
 * -Remove `ExtRef` in case `intAddr` is missing
 *
 * 2. Removes leaf `Input` elements as well
 * 3. Removes subscription supervision
 * - when all external references of one control block are unsubscribed
 * - when `valKind` RO|Conf and `valImport` true
 * ```
 * In case the external reference
 * @param extRefs - Array of external references
 * @returns An array of update and/or remove action representing changes required
 * to unsubscribe.
 */
export function unsubscribe(extRefs: Element[]): (Update | Remove)[] {
  const updateActions: Update[] = [];
  const removeActions: Remove[] = [];

  extRefs.map((extRef) => {
    if (extRef.getAttribute("intAddr"))
      updateActions.push({
        element: extRef,
        attributes: {
          iedName: null,
          ldInst: null,
          prefix: null,
          lnClass: null,
          lnInst: null,
          doName: null,
          daName: null,
          srcLDInst: null,
          srcPrefix: null,
          srcLNClass: null,
          srcLNInst: null,
          srcCBName: null,
          serviceType: null,
        },
      });
    else removeActions.push({ node: extRef });
  });

  return [
    ...removeInputs(removeActions),
    ...updateActions,
    ...removeSubscriptionSupervision(extRefs),
  ];
}
