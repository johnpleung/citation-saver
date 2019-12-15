"use strict";

const citationSaver = {
    config: {
        profile: {
            startSpecificity: 3,
            maxSpecificity: 10
        },
        modal: {
            introText: 'Here\'s your Citation Saver link! Click to copy to clipboard.',
            copiedConfirmation: 'Copied to clipboard.'
        },
        ad: {
            url: 'https://johnpleung.github.io/citation-saver-ad/'
        }
    },
    utils: {
        sys: {
            select: profile => { // Selects content on a page based on the given profile
                try {
                    var selection = window.getSelection();
                    selection.removeAllRanges();
                    var range = document.createRange();
                    range.setStart(profile.start.node, profile.start.offset);
                    range.setEnd(profile.end.node, profile.end.offset);
                    selection.addRange(range);
                    return true;
                } catch (err) {}
                return false;
            },
            copyToClipboard: str => { // Copies a string to the clipboard
                try {
                    let el = document.createElement('textarea');
                    el.value = str;
                    document.body.appendChild(el);
                    el.select();
                    document.execCommand('copy');
                    document.body.removeChild(el);
                    return true;
                } catch (err) {}
                return false;
            }
        },
        reduceJSON: json => json.replace(/(\")(\w{1,2})(\")\:/g, '$2\:').slice(1, -1), // Removes quotation marks around property names and remove curly braces (in order to reduce size of hash)
        expandJSON: json => '{' + (',' + json).replace(/\,(s|e|a1|a2|m|v)\:/g, '\,\"$1\"\:').slice(1) + '}', // Adds quotation marks back in (in order to properly parse JSON)
        generateUrl: profile => { // Generates a Citation Saver URL
            try {
                let version;
                if (chrome && chrome.runtime && chrome.runtime.getManifest) {
                    version = +chrome.runtime.getManifest().version; // Cast to number
                }
                profile.v = version || 1; // Default to v1 if nothing

                let hash = citationSaver.utils.reduceJSON(JSON.stringify(profile));
                return window.location.origin + window.location.pathname + window.location.search + '#' + window.btoa(hash);
            } catch (err) {}
            return null;
        },
        prunePhrase: phrase => { // Normalizes text to help with parsing
            try {
                phrase = phrase.replace(/[\r\n\t]/g, ' ');
                phrase = phrase.replace(/ {2,}/g, ' '); // Make sure no double spaces anywhere
            } catch (err) {}
            return phrase;
        },
        escapeRegEx: str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), // Escapes chars that interfere with regex's
        toggleTextTransform: enable => { // Toggles text-transform
            if (!enable) {
                let $styleTag;
                $styleTag = jQuery(`
                <style id="citation-saver-disable-text-transform">
                    * {
                        text-transform: none!important;
                    }    
                </style>`).appendTo('body');
            } else {
                jQuery('#citation-saver-disable-text-transform').remove();
            }
        }
    },
    parse: {
        getUniqueProfile: () => { // Try to generate a unique profile for the selected content which will serve as the basis for the hash
            // Initial requirements check
            if (!citationSaver.parse.meetsMinimumRequirements(citationSaver.utils.prunePhrase(window.getSelection().toString()))) {
                return null;
            }
            let profile;
            try {
                // Temporarily disable text-transforms, which interfere with our selectors
                citationSaver.utils.toggleTextTransform(false);

                // In order to make the hash as short as possible, we start with less specific markers and increment until we end up with a profile that is unique
                for (let i = citationSaver.config.profile.startSpecificity; i < citationSaver.config.profile.maxSpecificity + 1; i++) {
                    profile = citationSaver.citation.getProfile(i);

                    // See if this profile is unique
                    if (citationSaver.citation.validate(profile)) {
                        // If profile.m is not needed, discard so we end up with an even shorter hash
                        let profile2 = Object.assign({}, profile);
                        if (profile2.m) {
                            delete profile2.m;
                        }
                        if (citationSaver.citation.validate(profile2)) {
                            profile = profile2;
                        }
                        break;
                    }
                    profile = null;
                }

            } catch (err) {}

            // Restore text transforms (if there were any)
            citationSaver.utils.toggleTextTransform(true);

            return profile;
        },
        getFirstWords: (phrase, numWords) => { // Gets the first few words in a phrase
            try {
                phrase = jQuery.trim(phrase);
                let expr = new RegExp('^([^ ]+\\s){' + numWords + '}', 'g');
                let results = expr.exec(phrase);
                if (results) {
                    return results[0];
                }
            } catch (err) {}
            return null;
        },
        getLastWords: (phrase, numWords) => { // Gets the last few words in a phrase
            try {
                phrase = jQuery.trim(phrase);
                let expr = new RegExp('((\\s([^\\s])+){' + numWords + '})$', 'g');
                let results = expr.exec(phrase);
                if (results) {
                    return results[1];
                }
            } catch (err) {}
            return null;
        },
        getAcronymSignature: text => { // Produces a string that serves as a signature representing the words in a phrase in a way that indicates world length. Example: "hello world!" -> "h4;w5"
            try {
                let ret = '';
                let words = jQuery.trim(citationSaver.utils.prunePhrase(text)).split(' ');
                words.forEach(word => {
                    ret += ';' + word.charAt(0) + (word.length - 1);
                });
                return ret.slice(1);
            } catch (err) {}
            return null;
        },
        getAcronymMatchPosition: (textContent, profile, acronymPosition) => { // Finds instance of a phrase that seems to match a signature in a citation profile, produced by getAcronymSignature()
            try {
                let selector = '';
                let acronymSignature = (acronymPosition == 's' ? profile.a1 : profile.a2) + ';';
                let signatures = acronymSignature.match(/(.){1}(\d+)(\;)/g);
                if (signatures) {
                    signatures.forEach(signature => {
                        // Convert word signature (e.g., "h4") into another piece of the selector
                        let parts = signature.match(/(.){1}(\d+)/);
                        if (parts) {
                            selector += citationSaver.utils.escapeRegEx(parts[1]) + '([^\\s]{' + parts[2] + '})\\s?';
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
        },
        matchesText: (textContent, profile) => { // Determines whether or not a piece of text matches the citation profile provided
            try {
                let isMatch;
        
                // Step 1: Make sure the markers are in the right order
                let expr = citationSaver.utils.escapeRegEx(profile.s) + '(.*)';
                if (profile.m) {
                    expr += citationSaver.utils.escapeRegEx(profile.m) + '(.*)';
                }
                expr += citationSaver.utils.escapeRegEx(profile.e);
                isMatch = new RegExp(expr).test(textContent);
            
                // Step 2: Make sure the text matches the start acronym signature
                let startAcronymPosition;
                let endAcronymPosition;
                if (isMatch && profile.a1) {
                    startAcronymPosition = citationSaver.parse.getAcronymMatchPosition(textContent, profile, 's');
                    isMatch = startAcronymPosition !== null;
                }
                // Step 3: Make sure the text matches the end acronym signature
                if (isMatch && profile.a2) {
                    endAcronymPosition = citationSaver.parse.getAcronymMatchPosition(textContent, profile, 'e');
                    isMatch = endAcronymPosition !== null && endAcronymPosition > startAcronymPosition;
                }
                return isMatch;
            } catch (err) {}
            return false;
        },
        meetsMinimumRequirements: phrase => { // Ensure that the selected content meets minimum length and specificity requirements
            return (citationSaver.parse.getFirstWords(phrase, citationSaver.config.profile.startSpecificity) && citationSaver.parse.getLastWords(phrase, citationSaver.config.profile.startSpecificity));
        }
    },
    dom: {
        excludeNodeType: node => node.nodeType === 8, // Exclude COMMENT nodes
        getFragments: (results, elt) => { // Gets a flattened array of nodes contained in an element
            try {
                if (elt.childNodes && elt.childNodes.length) {
                    elt.childNodes.forEach(node => {
                        results = results.concat(citationSaver.dom.getFragments([], node));
                    });
                    return results;
                } else {
                    if (!citationSaver.dom.excludeNodeType(elt) && jQuery.trim(elt.textContent)) {
            
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
        },
        dedupeOccurrences: $elts => { // Filters out ancestors of the actual elements we want (the ones with most hierarchical depth)
            try {
                return $elts.filter((i1, elt1) => {
                    var isAncestorToAnotherItem = false;
                    $elts.each(function (i2, elt2) {
                        if (jQuery.contains(elt1, elt2)) {
                            isAncestorToAnotherItem = true;
                        }
                    });
                    return !isAncestorToAnotherItem;
                });
            } catch (err) {}
            return $elts;
        }
    },
    citation: {
        getMatchingContainers: profile => { // Gets the elements that contain stuff that matches the profile provided
            try {
                // Step 1: Find elements that contain the start and end phrases, regardless of the order in which the phrases appear
                let excludedTags = 'HTML,HEAD,HEAD *,SCRIPT,STYLE,TEMPLATE';
                let selector = `:not(${excludedTags}):visible`;
                let searchFragments = [ profile.s, profile.e ];
                if (profile.m) {
                    searchFragments.push(profile.m);
                }
                searchFragments.map(str => {
                    selector += ':contains(' + jQuery.escapeSelector(str) + ')';
                });

                // Temporarily disable text-transform, which interferes
                citationSaver.utils.toggleTextTransform(false);

                let $containers = jQuery(selector);

                // Step 2: Narrow down the list of elements to the ones that match the profile
                if ($containers.length > 1) {
                    $containers = $containers.filter((i, container) => {
                        let textContent = citationSaver.utils.prunePhrase(container.innerText); // Using .innerText because it includes line breaks whereas textContent doesn't always seem to (observed on https://www.ncbi.nlm.nih.gov/pubmed/22760575)
                        return citationSaver.parse.matchesText(textContent, profile);
                    });
                    $containers = citationSaver.dom.dedupeOccurrences($containers);
                }
                return $containers;
            } catch (err) {

            } finally {
                // Re-enable text-transform (if applicable)
                citationSaver.utils.toggleTextTransform(true);
            }
            return jQuery([]);
        },
        getProfile: specificity => { // Produce a profile, of a certain specificity, based on the current selection
            try {
                let excerptLength = specificity;
                let acronymLength = specificity;
                let selectedPhrase = jQuery.trim(window.getSelection().toString());

                // Break phrase into an array based on newlines/tabs
                let delimiter = '📋💾'; // Assuming this is not present in the phrase...
                let selectedPhraseSplit = selectedPhrase.replace(/[\r\n\t]/g, delimiter).split(delimiter).filter(x => x); // This fancy thing filters out empty strings. We'll use this val so that we can avoid newlines and other whitespace inconsistencies.
            
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
                    profile.m = jQuery.trim(selectedPhraseSplit[excerptIndex].slice(excerptOffset, excerptOffset + excerptLength));
                } else if (selectedPhraseSplit.length === 2) {
                    // If there are two lines, choose from the longer of the two lines
                    if (selectedPhraseSplit[0].length > selectedPhraseSplit[1].length) {
                        profile.m = jQuery.trim(selectedPhraseSplit[0].slice(-excerptLength));
                    } else {
                        profile.m = jQuery.trim(selectedPhraseSplit[1].slice(0, excerptLength));
                    }
                } // If there's only one line, we don't need a middle phrase marker

                // Step 3: Determine end phrase marker
                profile.e = selectedPhraseSplit.pop().slice(-excerptLength);
            
                // Step 4: Determine acronym signatures
                selectedPhrase = citationSaver.utils.prunePhrase(selectedPhrase);
                profile.a1 = citationSaver.parse.getAcronymSignature(citationSaver.parse.getFirstWords(selectedPhrase, acronymLength));
                profile.a2 = citationSaver.parse.getAcronymSignature(citationSaver.parse.getLastWords(selectedPhrase, acronymLength));
            
                return profile;
            } catch (err) {}
            return null;
        },
        validate: profile => { // Validates citation profile to make sure it's specific and produces correct results
            try {
                if (citationSaver.citation.getMatchingContainers(profile).length !== 1) {
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
                    length: jQuery.trim(sel.toString()).length
                };

                // Select content based on the profile
                citationSaver.citation.restore(profile, false);
                
                // If this profile isn't accurate, restore the previous selection
                if (window.getSelection().toString().length != currentSelectionProfile.length) {
                    citationSaver.utils.sys.select(currentSelectionProfile);
                    return false;
                }
            } catch (err) {
                return false;
            }
            return true;
        },
        restore: (profile, scrollIntoView, showNotification) => { // Tries to restore a selection based on a provided profile
            try {
                let $containers = citationSaver.citation.getMatchingContainers(profile);

                if (!$containers.length) {
                    return false;
                }

                let text = '';
                let nodeRange = [null, null];
 
                let fragments = citationSaver.dom.getFragments([], $containers[0]);

                // Try to identify the fragment that corresponds with the end of the phrase
                for (let i = 0; i < fragments.length; i++) {
                    text = citationSaver.utils.prunePhrase(text + fragments[i].val);
                    if (citationSaver.parse.matchesText(text, profile)) {
                        nodeRange[1] = i;
                        break;
                    }
                }
                // Try to identify the fragment that corresponds with the start of the phrase
                text = '';
                if (nodeRange[1] !== null) {
                    for (let i = nodeRange[1]; i >= 0; i--) {
                        text = citationSaver.utils.prunePhrase(fragments[i].val + text);
                        if (citationSaver.parse.matchesText(text, profile)) {
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
                            text += citationSaver.utils.prunePhrase(firstNode.textContent.charAt(i));
                            if (citationSaver.parse.matchesText(text, profile)) {
                                lastNodeOffset = i + 1;
                                break;
                            }
                        }
                        // Determine first node offset
                        text = '';
                        for (let i = firstNode.textContent.length - 1; i >= 0; i--) {
                            text = citationSaver.utils.prunePhrase(firstNode.textContent.charAt(i) + text);
                            if (citationSaver.parse.matchesText(text, profile)) {
                                firstNodeOffset = i;
                                break;
                            }
                        }
                    } else {
                        
                        // If the selection spans multiple nodes, let's determine the text made up by all the nodes excluding the first and last nodes
                        for (let i = nodeRange[0] + 1; i < nodeRange[1]; i++) {
                            middleText += citationSaver.utils.prunePhrase(fragments[i].val);
                        }
                        // Determine last node offset
                        for (let i = 1; i < lastNode.textContent.length + 1; i++) {
                            text = citationSaver.utils.prunePhrase(fragments[nodeRange[0]].val + middleText + lastNode.textContent.slice(0, i));
                            if (citationSaver.parse.matchesText(text, profile)) {
                                lastNodeOffset = i;
                                break;
                            }
                        }
                        // Determine first node offset
                        for (let i = 1; i <= firstNode.textContent.length; i++) {
                            text = citationSaver.utils.prunePhrase(firstNode.textContent.slice(-i) + middleText + fragments[nodeRange[1]].textContent);
                            if (citationSaver.parse.matchesText(text, profile)) {
                                firstNodeOffset = firstNode.textContent.length - i;
                                break;
                            }
                        }
                    }
            
                    if (firstNodeOffset !== null && lastNodeOffset != null) {
                        // Select content
                        citationSaver.utils.sys.select({
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
                                window.scrollTo(0, $(firstNode.parentNode).offset().top - ($(window).height() / 4));
                            }, 1);
                        }
                        if (showNotification) {
                            citationSaver.notification.show('Here\'s your citation!');
                        }
                        return true;
                    }
                }
                return false;
            } catch (err) {
                return false;
            }
        }
    },
    notification: {
        show: msg => { // Shows a fleeting notification message
            try {
                jQuery('#__citation-saver-notice-container').remove();

                let minDuration = 1500;
                let duration = Math.max(minDuration, msg.length * 50);

                let $elt = jQuery(`<div id="__citation-saver-notice-container"><div id="__citation-saver-notice"><div>${msg}</div></div></div>`);
    
                $elt.appendTo('body');
                window.setTimeout(() => {
                    $elt.addClass('__citation-saver-show');
                    window.setTimeout(() => {
                        $elt.removeClass('__citation-saver-show');
                        window.setTimeout(() => { // Remove element from DOM after a second
                            $elt.remove();
                        }, 1000);
                    }, duration);
                }, 1);
            } catch (err) {}
        }
    },
    modal: {
        close: callback => {
            jQuery('#__citation-saver-modal-cover').remove();
            if((typeof callback) == 'function') {
                callback();
            }
        },
        show: (url, callback) => { // Renders and shows a modal with results
            try {
                let imagePath = 'images/get_started48.png';

                // Main structure
                citationSaver.modal.close(callback);
                let $modalCover = jQuery('<div id="__citation-saver-modal-cover"></div>');
                let $modal = jQuery(`<div id="__citation-saver-modal" role="alert"><img id="__citation-saver-modal-logo" tabindex="1" src="../${imagePath}" alt="Citation Saver" /><div id="__citation-saver-modal-loading-content">Loading...</div><div id="__citation-saver-modal-main-content"><div id="__citation-saver-modal-label-intro" tabindex="2">${citationSaver.config.modal.introText}</div></div></div>`);
    
                // Ad unit
                jQuery(`<div id="__citation-saver-modal-ad-placeholder" role="presentation"><div id="__citation-saver-modal-ad-title">Advertisement</div><iframe id="__citation-saver-modal-ad-unit" role="presentation" frameborder="0" src="${citationSaver.config.ad.url}"></iframe></div>`).appendTo($modal);
    
                // Event handlers to close the modal
                $modalCover.append($modal).on('click', e => {
                    if (e.target === $modalCover[0]) {
                        citationSaver.modal.close(callback);
                    }
                }).appendTo('body').on('keydown', e => {
                    // Esc key
                    if (e.keyCode === 27) {
                        citationSaver.modal.close(callback);
                    }
                });

                // Render logo from bundled asset
                if (chrome && chrome.extension) {
                    jQuery('#__citation-saver-modal-logo').attr('src', chrome.extension.getURL(imagePath));
                }

                // Add link label and its event handlers
                let $link = jQuery(`<div id="__citation-saver-modal-label-link" tabindex="3" role="button">${url}</div>`).on('click', () => {
                    citationSaver.modal.copyToClipboard(url);
                }).on('keypress', e => {
                    if(e.keyCode === 13) {
                        citationSaver.modal.copyToClipboard(url);
                    }
                }).appendTo(jQuery('#__citation-saver-modal-main-content'));

                // Add a Close button
                jQuery(`<button id="__citation-saver-modal-close" tabindex="4">Close</button>`).on('click', () => {
                    citationSaver.modal.close(callback);
                }).appendTo(jQuery('#__citation-saver-modal-main-content'));

                window.setTimeout(() => {
                    $modalCover.addClass('__citation-saver-show'); // Initiates CSS transitions
                    $modal.focus(); // For web accessibility
    
                    // Wait a bit for the ad to render and be perceived before showing results
                    window.setTimeout(() => {
                        jQuery('#__citation-saver-modal-cover').addClass('__citation-saver-loaded');
                    }, 2500);
    
                }, 1);
            } catch (err) {}
        },
        copyToClipboard: url => { // When user clicks link to copy to clipboard...
            try {
                citationSaver.utils.sys.copyToClipboard(url); // TODO: Assuming operation was successful
                jQuery('#__citation-saver-modal-label-intro').text(citationSaver.config.modal.copiedConfirmation);
                window.setTimeout(() => {
                    // Wait 2 seconds, switch the text back to what it was
                    jQuery('#__citation-saver-modal-label-intro').text(citationSaver.config.modal.introText);
                }, 2000);
            } catch (err) {}
        }
    },
    main: {
        checkHash: () => { // Tries to process hash that may or may not be a valid Citation Saver hash
            if (window.location.hash) {
                let hash = window.decodeURI(window.location.hash.slice(1));
                try {
                    hash = citationSaver.utils.expandJSON(window.atob(hash));
                    let profile = JSON.parse(hash);

                    // Integrity check
                    if (profile && profile.v && profile.s && profile.e && profile.a1 && profile.a2) {
                        // If this didn't work, try again in 3 seconds. This is a crappy workaround for SPAs.
                        if(!citationSaver.citation.restore(profile, true, true)) {
                            window.setTimeout(() => {
                                citationSaver.citation.restore(profile, true, true);
                            }, 2000);
                        }
                    }
                } catch (err) {}
            }
        },
        processSelection: () => { // Tries to produce a hash from the selected content
            try {
                if (jQuery('#__citation-saver-modal-cover').length) {
                    return false;
                }
                let profile = citationSaver.parse.getUniqueProfile();
                if (profile) {
                    let url = citationSaver.utils.generateUrl(profile);
                    citationSaver.modal.show(url, () => {
                        citationSaver.citation.restore(profile, false, false);
                    });
                } else {
                    citationSaver.notification.show('Please select a longer and more unique phrase.');
                }
            } catch (err) {}
        }
    }
}

citationSaver.main.checkHash();