class CitationSaver {
    static PROFILE_START_SPECIFICITY = 3;
    static PROFILE_MAX_SPECIFICITY = 10;
    static MODAL_INTRO_TEXT = `Here's your Citation Saver link! Click to copy to clipboard.`;
    static MODAL_COPIED_CONFIRMATION = `Copied to clipboard.`;

    /**
     * GSelects content on a page based on the given profile
     * 
     * @param {object} selectionProfile
     * @return {boolean}
     */
    static selectContent (selectionProfile) {
        try {
            let profile = selectionProfile;
            var selection = window.getSelection();
            selection.removeAllRanges();
            var range = document.createRange();
            range.setStart(profile.start.node, profile.start.offset);
            range.setEnd(profile.end.node, profile.end.offset);
            selection.addRange(range);
            return true;
        } catch (err) {}
        return false;
    }

    /**
     * Removes quotation marks around property names and remove curly braces (in order to reduce size of hash)
     * 
     * @param {string} json
     * @return {string}
     */
    static reduceJSON (json) {
        return json.replace(/(\")(\w{1,3})(\")\:/g, '$2\:').slice(1, -1);
    }

    /**
     * Adds quotation marks back in (in order to properly parse JSON)
     * 
     * @param {string} json
     * @return {string}
     */
    static expandJSON (json) {
        return '{' + (',' + json).replace(/\,(s|sb|e|eb|a1|a1b|a2|a2b|m|mb|v)\:/g, '\,\"$1\"\:').slice(1) + '}';
    }

    /**
     * Generates a Citation Saver URL
     * 
     * @param {string} unescapedProfile
     * @return {string}
     */
    static generateUrl (unescapedProfile) {
        try {
            let version;
            if (chrome && chrome.runtime && chrome.runtime.getManifest) {
                version = parseInt(chrome.runtime.getManifest().version); // Get major version
            }
            let profile = unescapedProfile;
            profile.v = version || 1; // Default to v1 if nothing
            profile = CitationSaver.escapeProfile(profile);
            let hash = CitationSaver.reduceJSON(JSON.stringify(profile));
            return window.location.origin + window.location.pathname + window.location.search + '#' + window.btoa(hash);
        } catch (err) {
        }
        return null;
    }

    /**
     * Normalizes text to help with parsing
     * 
     * @param {string} phrase
     * @return {string}
     */
    static prunePhrase (phrase) {
        try {
            phrase = phrase.replace(/[\r\n\t]/g, ' ');
            phrase = phrase.replace(/ {2,}/g, ' '); // Make sure no double spaces anywhere
        } catch (err) {}
        return phrase;
    }

    /**
     * Escapes chars that interfere with regex's
     * 
     * @param {string} str
     * @return {string}
     */
    static escapeRegEx (str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Toggles text-transform
     * 
     * @return {void}
     */
    static toggleTextTransform (enable) {
        if (!enable) {
            let styleTag = document.createElement('style');
            styleTag.setAttribute('id', 'citation-saver-disable-text-transform');
            styleTag.innerHTML = `* { text-transform: none!important; }`;
            document.body.appendChild(styleTag);
        } else {
            document.querySelector('#citation-saver-disable-text-transform').remove();
        }
    }

    /**
     * Try to generate a unique (unescaped) profile for the selected content which will serve as the basis for the hash
     * 
     * @return {object}
     */
    static getUniqueProfile () {
        // Initial requirements check
        if (!CitationSaver.meetsMinimumRequirements(CitationSaver.prunePhrase(window.getSelection().toString()))) {
            return null;
        }
        let profile;
        try {
            // Temporarily disable text-transforms, which interfere with our selectors
            CitationSaver.toggleTextTransform(false);
            // In order to make the hash as short as possible, we start with less specific markers and increment until we end up with a profile that is unique
            for (let i = CitationSaver.PROFILE_START_SPECIFICITY; i < CitationSaver.PROFILE_MAX_SPECIFICITY + 1; i++) {
                profile = CitationSaver.getUnescapedProfile(i);
                // See if this profile is unique
                if (CitationSaver.validate(profile)) {
                    // If profile.m is not needed, discard so we end up with an even shorter hash
                    let profile2 = Object.assign({}, profile);
                    if (profile2.m) {
                        delete profile2.m;
                        if (CitationSaver.validate(profile2)) {
                            profile = profile2;
                        }
                    }
                    break;
                }
                profile = null;
            }
        } catch (err) {}
        // Restore text transforms (if there were any)
        CitationSaver.toggleTextTransform(true);
        return profile;
    }

    /**
     * Gets the first few words in a phrase
     * 
     * @param {string} phrase
     * @param {number} numWords
     * @return {string}
     */
    static getFirstWords (phrase, numWords) {
        try {
            phrase = phrase?.trim();
            let expr = new RegExp('^([^ ]+\\s){' + numWords + '}', 'g');
            let results = expr.exec(phrase);
            if (results) {
                return results[0];
            }
        } catch (err) {}
        return null;
    }

    /**
     * Gets the last few words in a phrase
     * 
     * @param {string} phrase
     * @param {number} numWords
     * @return {string}
     */
    static getLastWords (phrase, numWords) {
        try {
            phrase = phrase?.trim();
            let expr = new RegExp('((\\s([^\\s])+){' + numWords + '})$', 'g');
            let results = expr.exec(phrase);
            if (results) {
                return results[1];
            }
        } catch (err) {}
        return null;
    }

    /**
     * Produces a string that serves as a signature representing the words in a phrase in a way that indicates world length. Example: "hello world!" -> "h4;w5"
     * 
     * @param {string} text
     * @return {string}
     */
    static getAcronymSignature (text) {
        try {
            let ret = '';
            let words = CitationSaver.prunePhrase(text).trim().split(' ');
            words.forEach(word => {
                ret += ';' + word.charAt(0) + (word.length - 1);
            });
            return ret.slice(1);
        } catch (err) {}
        return null;
    }

    /**
     * Finds instance of a phrase that seems to match a signature in a citation profile, produced by getAcronymSignature()
     * 
     * @param {string} textContent
     * @param {object} unescapedProfile
     * @param {string} acronymPosition
     * @return {number}
     */
    static getAcronymMatchPosition (textContent, unescapedProfile, acronymPosition) {
        try {
            let profile = unescapedProfile;
            let selector = '';
            let acronymSignature = (acronymPosition === 's' ? profile.a1 : profile.a2) + ';';
            let signatures = acronymSignature.match(/(.){1}(\d+)(\;)/g);
            if (signatures) {
                signatures.forEach(signature => {
                    // Convert word signature (e.g., "h4") into another piece of the selector
                    let parts = signature.match(/(.){1}(\d+)/);
                    if (parts) {
                        selector += CitationSaver.escapeRegEx(parts[1]) + '([^\\s]{' + parts[2] + '})\\s?';
                    }
                });
            } else {
                return null;
            }
            // Find based on selector/regex expression
            let match = new RegExp(selector, 'g').exec(textContent.replace(/ /g, ''));
            if (match) {
                return match.index;
            }
        } catch (err) {}
        return null;
    }

    /**
     * Determines whether or not a piece of text matches the citation profile provided
     * 
     * @param {string} textContent
     * @param {object} unescapedProfile
     * @return {boolean}
     */
    static matchesText (textContent, unescapedProfile) {
        try {
            let isMatch;
            let profile = unescapedProfile;
            // Step 1: Make sure the markers are in the right order
            let expr = CitationSaver.escapeRegEx(profile.s) + '(.*)';
            if (profile.m) {
                expr += CitationSaver.escapeRegEx(profile.m) + '(.*)';
            }
            expr += CitationSaver.escapeRegEx(profile.e);
            isMatch = new RegExp(expr).test(textContent);
            // Step 2: Make sure the text matches the start acronym signature
            let startAcronymPosition;
            let endAcronymPosition;
            if (isMatch && profile.a1) {
                startAcronymPosition = CitationSaver.getAcronymMatchPosition(textContent, profile, 's');
                isMatch = startAcronymPosition !== null;
            }
            // Step 3: Make sure the text matches the end acronym signature
            if (isMatch && profile.a2) {
                endAcronymPosition = CitationSaver.getAcronymMatchPosition(textContent, profile, 'e');
                isMatch = endAcronymPosition !== null && endAcronymPosition > startAcronymPosition;
            }
            return isMatch;
        } catch (err) {}
        return false;
    }

    /**
     * Ensures that the selected content meets minimum length and specificity requirements
     * 
     * @param {string} phrase
     * @return {boolean}
     */
    static meetsMinimumRequirements (phrase) {
        return (CitationSaver.getFirstWords(phrase, CitationSaver.PROFILE_START_SPECIFICITY) && CitationSaver.getLastWords(phrase, CitationSaver.PROFILE_START_SPECIFICITY));
    }

    /**
     * Creates an HTML element of the given tag name, attributes, and inner HTML. If appendTo is provided, the resulting element will be appended as a child to the given element
     * 
     * @param {string} tagName
     * @param {object} attributes
     * @param {string} innerHTML
     * @param {HtmlElement} appendTo
     * @return {HtmlElement}
     */
    static createElement (tagName, attributes, innerHTML, appendTo) {
        let elt = document.createElement(tagName);
        if (attributes) {
            Object.keys(attributes).forEach(key => {
                elt.setAttribute(key, attributes[key]);
            });
        }
        if (innerHTML) {
            elt.innerHTML = innerHTML;
        }
        if (appendTo) {
            if (typeof appendTo === 'string') {
                document.querySelector(appendTo)?.appendChild(elt);
            } else {
                appendTo.appendChild(elt);                    
            }
        }
        return elt;
    }

    /**
     * Determines whether the given HTML element is noteworthy to us
     * 
     * @param {HtmlElement} node
     * @return {boolean}
     */
    static excludeNodeType (node) {
        return node.nodeType === 8; // Exclude COMMENT nodes
    }

    /**
     * Gets a flattened array of nodes contained in an element
     * 
     * @param {Array<HtmlElement>} results
     * @param {HtmlElement} elt
     * @return {Array<HtmlElement>}
     */
    static getFragments (results, elt) {
        try {
            if (elt.childNodes && elt.childNodes.length) {
                elt.childNodes.forEach(node => {
                    results = results.concat(CitationSaver.getFragments([], node));
                });
                return results;
            } else {
                if (!CitationSaver.excludeNodeType(elt) && elt.textContent?.trim()) {
                    let shouldAppendSpace;
                    // Special case for <td>'s: Add a space character if it's the last node in a <td>, because otherwise you end up with "TD contentsome other words"
                    if (elt.parentNode.tagName == 'TD' && Array.from(elt.parentNode.childNodes).pop() === elt) {
                        shouldAppendSpace = true;
                    }
                    // Store the desired text content in a custom property so we don't alter the actual text content of the document
                    elt.val = elt.textContent + (shouldAppendSpace ? ' ' : '');
                    return [ elt ];
                } else {
                    return [];
                }
            }
        } catch (err) {}
        return results;
    }

    /**
     * Returns an array of each node going up the DOM tree, beginning with the node containing the given element
     * 
     * @param {HtmlElement} elt
     * @return {Array<HtmlElement>}
     */
    static getHierarchyTree (elt) {
        let ret = [];
        let currentNode = elt;
        while (true) {
            currentNode = currentNode.parentNode;
            if (currentNode) {
                ret.push(currentNode);
            } else {
                break;
            }
        }
        return ret;
    }

    /**
     * Filters out ancestors of the actual elements we want (the ones with most hierarchical depth)
     * 
     * @param {Array<HtmlElement>} elts
     * @return {Array<HtmlElement>}
     */
    static dedupeOccurrences (elts) {
        let ret = [];
        for (let elt1 of elts) {
            let isUnique = true;
            for (let elt2 of elts) {
                if (elt1 !== elt2) {
                    let hierarchy = CitationSaver.getHierarchyTree(elt2);
                    if (hierarchy.includes(elt1)) {
                        isUnique = false;
                        break;
                    }
                }
            }
            if (isUnique) {
                ret.push(elt1);
            }
        }
        return ret;
    }

    /**
     * Gets an array of elements, excluding those with the given tag names, containing the given phrases
     * 
     * @param {Array<string>} excludedTags
     * @param {Array<string>} phrases
     * @return {Array<HtmlElement>}
     */
    static getElementsContainingPhrases (excludedTags, phrases) {
        let elts = Array.from(document.querySelectorAll(`:not(${excludedTags.join(',')})`));
        elts = elts.filter(elt => {
            for (let phrase of phrases) {
                if (!elt.textContent?.includes(phrase)) {
                    return false;
                }
            }
            return true;
        });
        return elts.length ? elts : null;
    }

    /**
     * Sets the text content of the first element that matches the given selector
     * 
     * @param {string} selector
     * @param {string} text
     * @return {void}
     */
    static setText (selector, text) {
        let elt = document.querySelector(selector);
        if (elt) {
            elt.textContent = text;
        }
    }

    /**
     * Gets the elements that contain stuff that matches the profile provided
     * 
     * @param {object} unescapedProfile
     * @return {Array<HtmlElement>}
     */
    static getMatchingContainers (unescapedProfile) {
        try {
            let profile = unescapedProfile;
            // Step 1: Find elements that contain the start and end phrases, regardless of the order in which the phrases appear
            let searchFragments = [ profile.s, profile.e ];
            if (profile.m) {
                searchFragments.push(profile.m);
            }
            // Temporarily disable text-transform, which interferes
            CitationSaver.toggleTextTransform(false);
            let matchingElements = CitationSaver.getElementsContainingPhrases([ 'HTML', 'HEAD', 'HEAD *', 'SCRIPT', 'STYLE', 'TEMPLATE' ], searchFragments);
            if (matchingElements?.length) {
                // Step 2: Narrow down the list of elements to the ones that are visible and that match the profile
                matchingElements = matchingElements.filter(elt => {
                    if (elt.checkVisibility()) {
                        let textContent = CitationSaver.prunePhrase(elt.innerText); // Using .innerText because it includes line breaks whereas textContent doesn't always seem to (observed on https://www.ncbi.nlm.nih.gov/pubmed/22760575)
                        return CitationSaver.matchesText(textContent, profile);
                    }
                    return false;
                });
                if (matchingElements.length) {
                    matchingElements = CitationSaver.dedupeOccurrences(matchingElements);
                }
                return matchingElements.length ? matchingElements : null;
            }
        } catch (err) {
        } finally {
            // Re-enable text-transform (if applicable)
            CitationSaver.toggleTextTransform(true);
        }
    }

    /**
     * Produce a profile, of a certain specificity, based on the current selection
     * 
     * @param {number} specificity
     * @return {object}
     */
    static getUnescapedProfile (specificity) {
        try {
            let excerptLength = specificity;
            let acronymLength = specificity;
            let selectedPhrase = window.getSelection().toString().trim();
            // Break phrase into an array based on newlines/tabs
            let delimiter = '📋💾'; // Assuming this is not present in the phrase...
            let selectedPhraseSplit = selectedPhrase.replace(/[\r\n\t]/g, delimiter).split(delimiter).filter(x => x); // Filter out empty strings. We'll use this val so that we can avoid newlines and other whitespace inconsistencies.
            // Step 1: Determine start phrase marker
            let profile = {
                s: selectedPhraseSplit[0].slice(0, excerptLength), // (s)tart
                e: null // (e)nd
            };
            // Step 2: Determine middle phrase marker (if needed)
            // Find a good basis for the middle phrase marker
            if (selectedPhraseSplit.length >= 3) {
                // If more than three lines, choose something somewhere toward the middle
                let excerptIndex = Math.floor(selectedPhraseSplit.length / 2);
                let excerptOffset = Math.ceil(0, Math.floor((selectedPhraseSplit[excerptIndex].length - excerptLength) / 2));
                profile.m = (selectedPhraseSplit[excerptIndex].slice(excerptOffset, excerptOffset + excerptLength)).trim();
            } else if (selectedPhraseSplit.length === 2) {
                // If there are two lines, choose from the longer of the two lines
                if (selectedPhraseSplit[0].length > selectedPhraseSplit[1].length) {
                    profile.m = (selectedPhraseSplit[0].slice(-excerptLength)).trim();
                } else {
                    profile.m = (selectedPhraseSplit[1].slice(0, excerptLength)).trim();
                }
            } // If there's only one line, we don't need a middle phrase marker
            // Step 3: Determine end phrase marker
            profile.e = selectedPhraseSplit.pop().slice(-excerptLength);
            // Step 4: Determine acronym signatures
            selectedPhrase = CitationSaver.prunePhrase(selectedPhrase);
            profile.a1 = CitationSaver.getAcronymSignature(CitationSaver.getFirstWords(selectedPhrase, acronymLength));
            profile.a2 = CitationSaver.getAcronymSignature(CitationSaver.getLastWords(selectedPhrase, acronymLength));
            return profile;
        } catch (err) {}
        return null;
    }

    /**
     * Determines whether the given string can be represented in the Latin-1/ASCII character set
     * 
     * @param {string} str
     * @return {boolean}
     */
    static isLatin1 (str) {
        try {
            window.atob(str);
            return true;
        } catch (ex) {}
        return false;
    }

    /**
     * Escapes the given profile.
     * 
     * If a portion of a profile (e.g., "s", "e", "m", etc.) is not supported by base64 encoding (i.e., it's non-ASCII), this function will replace the portion with a CSV of numbers representing byte values.
     * 
     * @param {object} profile
     * @return {object}
     */
    static escapeProfile (profile) {
        const props = [ 's', 'e', 'm', 'a1', 'a2' ];
        props.forEach(prop => {
            let val = profile[prop];
            if (val && !CitationSaver.isLatin1(val)) {
                profile[prop + 'b'] = CitationSaver.stringToBytes(val).toString();
                delete profile[prop];
            }
        });
        return profile;
    }

    /**
     * Converts the given profile (which may be escaped) to an unescaped profile
     * 
     * @param {object} profile
     * @return {object}
     */
    static unescapeProfile (profile) {
        const props = [ 's', 'e', 'm', 'a1', 'a2' ];
        props.forEach(prop => {
            let val = profile[prop + 'b'];
            if (val) {
                val = Uint8Array.from(val.split(','));
                profile[prop] = CitationSaver.bytesToString(val).toString();
                delete profile[prop + 'b'];
            }
        });
        return profile;
    }

    /**
     * Converts the given string into an Uint8Array
     * 
     * @param {string} text
     * @return {Uint8Array}
     */
    static stringToBytes (text) {
        return new TextEncoder().encode(text);
    }

    /**
     * Converts the given Uint8Array into a string
     * 
     * @param {Uint8Array} bytes
     * @return {string}
     */
    static bytesToString (bytes) {
        return new TextDecoder().decode(bytes);
    }

    /**
     * Validates citation profile to make sure it's specific and produces correct results
     * 
     * @param {object} unescapedProfile
     * @return {boolean}
     */
    static validate (unescapedProfile) {
        try {
            let profile = unescapedProfile;
            if (CitationSaver.getMatchingContainers(profile)?.length !== 1) {
                return false;
            }
            // Take snapshot of current selection
            let sel = window.getSelection();
            let currentSelectionProfile = {
                start: {
                    node: sel.anchorNode,
                    offset: sel.anchorOffset
                },
                end: {
                    node: sel.focusNode,
                    offset: sel.focusOffset
                },
                length: sel.toString().trim().length
            };
            // Select content based on the profile
            CitationSaver.restore(profile, false);
            // If this profile isn't accurate, restore the previous selection
            if (window.getSelection().toString().length != currentSelectionProfile.length) {
                CitationSaver.selectContent(currentSelectionProfile);
                return false;
            }
        } catch (err) {
            return false;
        }
        return true;
    }

    /**
     * Tries to restore a selection based on a provided profile
     * 
     * @param {object} unescapedProfile
     * @param {boolean} scrollIntoView
     * @param {boolean} showNotification
     * @return {boolean}
     */
    static restore (unescapedProfile, scrollIntoView, showNotification) {
        try {
            let profile = unescapedProfile;
            let containers = CitationSaver.getMatchingContainers(profile);
            if (!containers?.length) {
                return false;
            }
            let text = '';
            let nodeRange = [null, null];
            let fragments = CitationSaver.getFragments([], containers[0]);
            // Try to identify the fragment that corresponds with the end of the phrase
            for (let i = 0; i < fragments.length; i++) {
                text = CitationSaver.prunePhrase(text + fragments[i].val);
                if (CitationSaver.matchesText(text, profile)) {
                    nodeRange[1] = i;
                    break;
                }
            }
            // Try to identify the fragment that corresponds with the start of the phrase
            text = '';
            if (nodeRange[1] !== null) {
                for (let i = nodeRange[1]; i >= 0; i--) {
                    text = CitationSaver.prunePhrase(fragments[i].val + text);
                    if (CitationSaver.matchesText(text, profile)) {
                        nodeRange[0] = i;
                        break;
                    }
                }
            }
            if (nodeRange[0] !== null && nodeRange[1] !== null) {
                // Now that we've narrowed it down to the fragments, we want to figure out the start and end offsets
                let middleText = '';
                let firstNode = fragments[nodeRange[0]];
                let lastNode = fragments[nodeRange[1]];
                let firstNodeOffset;
                let lastNodeOffset;
                if (firstNode === lastNode) {
                    // Determine last node offset
                    text = '';
                    for (let i = 0; i < firstNode.textContent.length; i++) {
                        text += CitationSaver.prunePhrase(firstNode.textContent.charAt(i));
                        if (CitationSaver.matchesText(text, profile)) {
                            lastNodeOffset = i + 1;
                            break;
                        }
                    }
                    // Determine first node offset
                    text = '';
                    for (let i = firstNode.textContent.length - 1; i >= 0; i--) {
                        text = CitationSaver.prunePhrase(firstNode.textContent.charAt(i) + text);
                        if (CitationSaver.matchesText(text, profile)) {
                            firstNodeOffset = i;
                            break;
                        }
                    }
                } else {
                    // If the selection spans multiple nodes, let's determine the text made up by all the nodes excluding the first and last nodes
                    for (let i = nodeRange[0] + 1; i < nodeRange[1]; i++) {
                        middleText += CitationSaver.prunePhrase(fragments[i].val);
                    }
                    // Determine last node offset
                    for (let i = 1; i < lastNode.textContent.length + 1; i++) {
                        text = CitationSaver.prunePhrase(fragments[nodeRange[0]].val + middleText + lastNode.textContent.slice(0, i));
                        if (CitationSaver.matchesText(text, profile)) {
                            lastNodeOffset = i;
                            break;
                        }
                    }
                    // Determine first node offset
                    for (let i = 1; i <= firstNode.textContent.length; i++) {
                        text = CitationSaver.prunePhrase(firstNode.textContent.slice(-i) + middleText + fragments[nodeRange[1]].textContent);
                        if (CitationSaver.matchesText(text, profile)) {
                            firstNodeOffset = firstNode.textContent.length - i;
                            break;
                        }
                    }
                }
                if (firstNodeOffset !== null && lastNodeOffset != null) {
                    // Select content
                    CitationSaver.selectContent({
                        start: {
                            node: firstNode,
                            offset: firstNodeOffset
                        },
                        end: {
                            node: lastNode,
                            offset: lastNodeOffset
                        }
                    });
                    if (scrollIntoView) {
                        // Make sure the content is visible by scrolling to it
                        window.setTimeout(() => {
                            firstNode.parentNode?.scrollIntoView({
                                behavior: 'instant',
                                block: 'center'
                            });
                        }, 1);
                    }
                    if (showNotification) {
                        CitationSaver.showNotification('Here\'s your citation!');
                    }
                    return true;
                }
            }
            return false;
        } catch (err) {
            return false;
        }
    }

    /**
     * Shows a fleeting notification message
     * 
     * @param {string} msg
     * @return {void}
     */
    static showNotification (msg) {
        try {
            document.querySelector('#__citation-saver-notice-container')?.remove();
            let minDuration = 1500;
            let duration = Math.max(minDuration, msg.length * 50);
            let elt = CitationSaver.createElement('div', { id: '__citation-saver-notice-container' }, `<div id="__citation-saver-notice"><div>${msg}</div></div>`, document.body);
            window.setTimeout(() => {
                elt.classList.add('__citation-saver-show');
                window.setTimeout(() => {
                    elt.classList.remove('__citation-saver-show');
                    window.setTimeout(() => { // Remove element from DOM after a second
                        elt.remove();
                    }, 1000);
                }, duration);
            }, 1);
        } catch (err) {}
    }

    /**
     * Closes the open modal and calls the provided callback
     * 
     * @param {Function} callback
     * @return {void}
     */
    static closeModal (callback) {
        document.querySelector('#__citation-saver-modal-cover')?.remove();
        if((typeof callback) == 'function') {
            callback();
        }
    }

    /**
     * Renders and shows a modal with results
     * 
     * @return {void}
     */
    static showModal (url, callback) {
        try {
            let logoPath = chrome.runtime.getURL('images/get_started48.png');
            let buyMeACoffeePath = chrome.runtime.getURL('images/buymeacoffee.png');
            // Main structure
            CitationSaver.closeModal(callback);
            let modal = CitationSaver.createElement('div', { id: '__citation-saver-modal', role: 'alert' }, `<img id=-"__citation-savermodal-logo" tabindex="1" src="${logoPath}" alt="Citation Saver" /><div id="__citation-saver-modal-loading-content">Loading...</div><div id="__citation-saver-modal-main-content"><div id="__citation-saver-modal-label-intro" tabindex="2">${CitationSaver.MODAL_INTRO_TEXT}</div></div>`);
            let modalCover = CitationSaver.createElement('div', { id: '__citation-saver-modal-cover' }, null);
            CitationSaver.createElement('div', { id: '__citation-saver-modal-ad-placeholder', role: 'presentation' }, `<a href="https://buymeacoffee.com/johnpleung" target="_blank"><img src="${buyMeACoffeePath}"></a>`, modal);
            // Event handlers to close the modal
            modalCover.addEventListener('click', e => {
                if (e.target === modalCover) {
                    CitationSaver.closeModal(callback);
                }
            });
            document.body.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    CitationSaver.closeModal();
                }
            });
            modalCover.appendChild(modal);
            document.body.appendChild(modalCover);
            // Render logo from bundled asset
            if (chrome && chrome.extension) {
                document.querySelector('#__citation-saver-modal-logo')?.setAttribute('src', logoPath);
            }
            // Add link label and its event handlers
            let link = CitationSaver.createElement('div', { id: '__citation-saver-modal-label-link', tabindex: 3, role: 'button' }, url, '#__citation-saver-modal-main-content');
            link.addEventListener('click', async e => {
                await CitationSaver.copyToClipboard(url);
            });
            link.addEventListener('keypress', async e => {
                if (e.key === 'Enter') {
                    await CitationSaver.copyToClipboard(url);
                }
            });
            // Add a Close button
            let closeButton = CitationSaver.createElement('button', { id: '__citation-saver-modal-close', tabindex: 4 }, 'Close', '#__citation-saver-modal-main-content');
            closeButton.addEventListener('click', async e => {
                CitationSaver.closeModal(callback);
            });
            window.setTimeout(() => {
                modalCover.classList.add('__citation-saver-show'); // Initiates CSS transitions
                link.focus(); // For web accessibility
                // Wait a bit for the ad to render and be perceived before showing results
                window.setTimeout(() => {
                    document.querySelector('#__citation-saver-modal-cover')?.classList.add('__citation-saver-loaded');
                }, 2500);
            }, 500);
        } catch (err) {
        }
    }

    /**
     * When user clicks link to copy to clipboard...
     * 
     * @return {void}
     */
    static copyToClipboard (url) {
        try {
            navigator.clipboard.writeText(url);
            CitationSaver.setText('#__citation-saver-modal-label-intro', CitationSaver.MODAL_COPIED_CONFIRMATION);
            window.setTimeout(() => {
                // Wait 2 seconds, switch the text back to what it was
                CitationSaver.setText('#__citation-saver-modal-label-intro', CitationSaver.MODAL_INTRO_TEXT);
            }, 2000);
        } catch (err) {}
    }

    /**
     * Tries to process hash that may or may not be a valid Citation Saver hash
     * 
     * @return {void}
     */
    static checkHash () {
        if (window.location.hash) {
            let hash = window.decodeURI(window.location.hash.slice(1));
            try {
                hash = CitationSaver.expandJSON(window.atob(hash));
                let profile = CitationSaver.unescapeProfile(JSON.parse(hash));
                // Integrity check
                if (profile && profile.v && profile.s && profile.e && profile.a1 && profile.a2) {
                    // If this didn't work, try again in 3 seconds. This is a crappy workaround for SPAs.
                    if(!CitationSaver.restore(profile, true, true)) {
                        window.setTimeout(() => {
                            CitationSaver.restore(profile, true, true);
                        }, 2000);
                    }
                }
            } catch (err) {
            }
        }
    }

    /**
     * Generates a link for the current selection and presents it to the user
     * 
     * @return {void}
     */
    static async processSelection () {
        try {
            if (document.querySelector('#__citation-saver-modal-cover')) {
                return false;
            }
            let profile = CitationSaver.getUniqueProfile();
            if (profile) {
                let url = CitationSaver.generateUrl(profile);
                await CitationSaver.showModal(url, () => {
                    CitationSaver.restore(profile, false, false);
                });
            } else {
                CitationSaver.showNotification('Please select a longer and more unique phrase.');
            }
        } catch (err) {}
    }
}

CitationSaver.checkHash();