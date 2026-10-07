(() => {
    if (window.steamWatchScannerRunning) {
        console.log("⚠️ Scanner is already running.");
        return;
    }

    window.steamWatchScannerRunning = true;

    // =========================
    // CONFIG
    // =========================

    const CONFIG = {
        MIN_WATCHED: 100,
        MAX_WATCHED: 3000,

        TRACKER_SIZE: 100,
        DISPLAY_SIZE: 5,

        MIN_PRICE: 200,
        STOP_PRICE: 100,

        NORMAL_DELAY_MS: 1000,
        EMPTY_DELAY_MS: 500,
        ERROR_DELAY_MS: 5000,

        VERBOSE_LOGGING: false,

        RETRY_DELAY_MS: 5000,
        MAX_RETRIES: 3
    };


    // =========================
    // TRACKER CONFIGURATIONS
    // =========================

    const TRACKERS = {

        general: {
            key: "steam_top20_under_200",
            minWatched: 100,
            maxWatched: null,
            label: "UNDER ₱200"
        },

        watched100: {
            key: "steam_cheapest_100_plus",
            minWatched: 100,
            maxWatched: 999,
            label: "100+ GAMES WATCHED"
        },

        watched1000: {
            key: "steam_cheapest_1000_plus",
            minWatched: 1000,
            maxWatched: null,
            label: "1000+ GAMES WATCHED"
        }

    };


    // =========================
    // STORAGE KEYS
    // =========================

    const STORAGE_KEYS = {
        COUNTER: "steam_games_watched_counter",
        STOP: "steam_stopped_under_50"
    };


    // =========================
    // TYPE DEFINITIONS (JSDoc)
    // =========================

    /**
     * @typedef {Object} Listing
     * @property {number} price
     * @property {number} gamesWatched
     * @property {number} timestamp
     * @property {boolean} [_newBatch]
     */

    /**
     * @typedef {Object} ExtractResult
     * @property {Listing[]} listings
     * @property {number} buyButtons
     */

    /**
     * @typedef {Object} TrackerResult
     * @property {boolean} changed
     * @property {Listing[]} newEntries
     */


    // =========================
    // CACHED DOM PARSER
    // =========================

    const domParser = new DOMParser();


    // =========================
    // STORAGE HELPERS
    // =========================

    function loadArray(key) {
        try {
            return JSON.parse(
                localStorage.getItem(key) || "[]"
            );
        } catch {
            return [];
        }
    }


    function saveArray(key, value) {
        localStorage.setItem(
            key,
            JSON.stringify(value)
        );
    }


    function loadCounter() {
        const saved = parseInt(
            localStorage.getItem(STORAGE_KEYS.COUNTER),
            10
        );

        if (
            Number.isFinite(saved) &&
            saved >= CONFIG.MIN_WATCHED &&
            saved <= CONFIG.MAX_WATCHED
        ) {
            return saved;
        }

        return CONFIG.MIN_WATCHED;
    }


    function saveCounter(value) {
        localStorage.setItem(
            STORAGE_KEYS.COUNTER,
            String(value)
        );
    }


    // =========================
    // EXTRACT LISTINGS
    // =========================

    function extractListings(html) {

        const doc =
            domParser.parseFromString(
                html,
                "text/html"
            );

        const listings = [];

        const buyButtons = [
            ...doc.querySelectorAll("button")
        ].filter(
            button =>
                button.innerText.trim() === "Buy"
        );


        buyButtons.forEach(button => {

            const priceContainer =
                button.parentElement;

            if (!priceContainer) return;


            const priceElement = [
                ...priceContainer.querySelectorAll("span")
            ].find(span =>
                /₱\s*[\d,]+(?:\.\d{1,2})?/.test(
                    span.innerText
                )
            );


            if (!priceElement) return;


            const match =
                priceElement.innerText.match(
                    /₱\s*([\d,]+(?:\.\d{1,2})?)/
                );


            if (!match) return;


            const price =
                parseFloat(
                    match[1].replace(/,/g, "")
                );


            if (
                Number.isFinite(price) &&
                price > 0
            ) {

                listings.push({
                    price
                });

            }

        });


        return {
            listings,
            buyButtons: buyButtons.length
        };

    }


    // =========================
    // ADD LISTINGS TO TRACKER
    // =========================

    function addListingsToTracker(
        key,
        minWatched,
        maxWatched,
        listings,
        gamesWatched
    ) {

        // Outside tracker range
        if (
            gamesWatched < minWatched
        ) {
            return {
                changed: false,
                newEntries: []
            };
        }


        if (
            maxWatched !== null &&
            gamesWatched > maxWatched
        ) {
            return {
                changed: false,
                newEntries: []
            };
        }


        if (!listings.length) {
            return {
                changed: false,
                newEntries: []
            };
        }


        const tracker =
            loadArray(key);


        // Only keep listings below ₱200
        const newEntries =
            listings
                .filter(
                    listing =>
                        listing.price < CONFIG.MIN_PRICE
                )
                .map(
                    (listing, index) => ({
                        price:
                            listing.price,

                        gamesWatched,

                        timestamp:
                            Date.now() * 1000 + index,

                        _newBatch: true
                    })
                );


        if (!newEntries.length) {
            return {
                changed: false,
                newEntries: []
            };
        }


        // Add new listings to existing tracker
        const combined = [
            ...tracker,
            ...newEntries
        ];


        // Cheapest first
        combined.sort(
            (a, b) =>
                a.price - b.price
        );


        // Keep only Top 100 individual listings
        const trimmed =
            combined.slice(
                0,
                CONFIG.TRACKER_SIZE
            );


        // Find new listings that survived into Top 100
        // and attach 1-based rank position
        const newEntriesKept =
            trimmed
                .map(
                    (item, index) =>
                        item._newBatch
                            ? {
                                ...item,
                                _rank: index + 1
                            }
                            : null
                )
                .filter(Boolean);


        // Remove temporary markers
        const cleaned =
            trimmed.map(item => {

                const {
                    _newBatch,
                    ...cleanItem
                } = item;

                return cleanItem;

            });


        saveArray(
            key,
            cleaned
        );


        return {
            changed:
                newEntriesKept.length > 0,

            newEntries:
                newEntriesKept
        };

    }


    // =========================
    // UPDATE ALL TRACKERS
    // =========================

    function updateTrackers(
        cheapListings,
        gamesWatched
    ) {

        const results = {};


        for (
            const [name, tracker]
            of Object.entries(TRACKERS)
        ) {

            results[name] =
                addListingsToTracker(
                    tracker.key,
                    tracker.minWatched,
                    tracker.maxWatched,
                    cheapListings,
                    gamesWatched
                );

        }


        return results;

    }


    // =========================
    // GROUP BY PRICE
    // =========================

    function groupByPrice(listings) {

        const groups =
            new Map();


        listings.forEach(item => {

            const priceKey =
                Number(item.price).toFixed(2);


            if (!groups.has(priceKey)) {

                groups.set(priceKey, {

                    price:
                        Number(priceKey),

                    count: 0,

                    gamesWatched:
                        item.gamesWatched

                });

            }


            groups.get(priceKey).count++;

        });


        return [
            ...groups.values()
        ].sort(
            (a, b) =>
                a.price - b.price
        );

    }


    // =========================
    // RANK → TOP EMOJI HELPER
    // =========================

    function formatTopRank(
        rank
    ) {

        const keycaps = {
            1: "1️⃣",
            2: "2️⃣",
            3: "3️⃣",
            4: "4️⃣",
            5: "5️⃣",
            6: "6️⃣",
            7: "7️⃣",
            8: "8️⃣",
            9: "9️⃣",
            10: "🔟"
        };

        const emoji =
            keycaps[rank] ||
            "";

        return `top ${rank}${emoji}`;

    }


    // =========================
    // GROUP NEW ENTRIES WITH RANK
    // =========================

    function groupNewEntriesByPrice(
        entries
    ) {

        const groups =
            new Map();

        entries.forEach(item => {

            const priceKey =
                Number(item.price).toFixed(2);

            if (!groups.has(priceKey)) {

                groups.set(priceKey, {

                    price:
                        Number(priceKey),

                    count: 0,

                    gamesWatched:
                        item.gamesWatched,

                    bestRank:
                        item._rank ||
                        Infinity

                });

            }

            const g =
                groups.get(priceKey);

            g.count++;

            if (
                (item._rank || Infinity) <
                g.bestRank
            ) {
                g.bestRank = item._rank;
            }

        });

        return [
            ...groups.values()
        ].sort(
            (a, b) =>
                a.price - b.price
        );

    }


    // =========================
    // DISPLAY NEW ENTRIES
    // =========================

    function displayNewEntries(
        title,
        newEntries
    ) {

        if (!newEntries.length) {
            return;
        }


        const groups =
            groupNewEntriesByPrice(
                newEntries
            );


        console.log("");


        const label =
            title
                ? ` ${title}`
                : "";


        console.log(
            `✨ NEW${label} TOP ${CONFIG.TRACKER_SIZE} ENTRY!`
        );


        groups.forEach(group => {

            const rankLabel =
                group.bestRank &&
                isFinite(group.bestRank)
                    ? `${formatTopRank(
                        group.bestRank
                    )} `
                    : "";

            console.log(
                `💵 ${rankLabel}` +
                `[${group.count}] ` +
                `₱${group.price.toFixed(2)} ` +
                `— Games watched: ` +
                `${group.gamesWatched}`
            );

        });

    }


    // =========================
    // DISPLAY TOP 5
    // =========================

    function displayTop5(
        title,
        key
    ) {

        const tracker =
            loadArray(key);


        if (!tracker.length) {

            console.log("");

            console.log(
                `🏆 TOP 5 — ${title}`
            );

            console.log(
                `📊 0/${CONFIG.TRACKER_SIZE} entries stored`
            );

            return;
        }


        const groups =
            groupByPrice(
                tracker
            );


        console.log("");

        console.log(
            `🏆 TOP 5 — ${title}`
        );


        groups
            .slice(
                0,
                CONFIG.DISPLAY_SIZE
            )
            .forEach(
                (group, index) => {

                    console.log(
                        `${index + 1}. ` +
                        `[${group.count}] ` +
                        `₱${group.price.toFixed(2)} ` +
                        `— Games watched: ` +
                        `${group.gamesWatched}`
                    );

                }
            );


        console.log(
            `📊 ${tracker.length}/${CONFIG.TRACKER_SIZE} entries stored`
        );

    }


    // =========================
    // OPEN BUY FLOW
    // =========================
    //
    // Navigates to Steam search, applies filters,
    // searches for games watched, clicks first matching listing.
    // Stops at the purchase modal (does not confirm purchase).
    //

    async function openBuyFlow(
        gamesWatched,
        targetPrice
    ) {

        console.log("");

        console.log(
            "🛒 Starting Buy flow..."
        );

        console.log(
            `💰 Target price: ₱${targetPrice.toFixed(2)}`
        );

        console.log(
            `🎮 Games watched: ${gamesWatched}`
        );

        const searchUrl =
            "https://steamcommunity.com/market/search" +
            "?category_Type=socket_gem" +
            "&appid=570" +
            `&q=games+watched%3A+${gamesWatched}` +
            "&descriptions=1";

        try {

            console.log("🌐 Navigating to Steam search...");

            // Navigate current tab to search URL
            window.location.href = searchUrl;

            // Wait for page to load and results to appear
            await waitForSearchResults();

            console.log("✅ Search results loaded");

            // Find and click the first listing matching target price
            const buyButton = findBuyButtonByPrice(targetPrice);

            if (!buyButton) {
                console.error(
                    `❌ No listing found at ₱${targetPrice.toFixed(2)}`
                );
                console.log(
                    "👉 You may need to manually select the correct listing."
                );
                return;
            }

            console.log(
                `✅ Found listing at ₱${targetPrice.toFixed(2)} — clicking Buy...`
            );

            buyButton.click();

            // Wait for purchase confirmation modal to appear
            await waitForModal("Purchase confirmation", () => findModalBuyButton());

            console.log("🛒 Purchase modal opened. Ready for manual confirmation.");

            console.log(
                "⚠️ Complete the purchase manually in the Steam dialog."
            );

        } catch (error) {

            console.error(
                "❌ Buy flow error:",
                error
            );

        }

    }


    // =========================
    // BUY FLOW HELPERS
    // =========================

    function findBuyButtonByPrice(
        targetPrice
    ) {

        const buttons = [
            ...document.querySelectorAll("button")
        ].filter(
            btn =>
                btn.innerText.trim() === "Buy"
        );

        for (const btn of buttons) {

            const container = btn.parentElement;
            if (!container) continue;

            const priceSpan = [
                ...container.querySelectorAll("span")
            ].find(span =>
                /₱\s*[\d,]+(?:\.\d{1,2})?/.test(
                    span.innerText
                )
            );

            if (!priceSpan) continue;

            const match = priceSpan.innerText.match(
                /₱\s*([\d,]+(?:\.\d{1,2})?)/
            );
            if (!match) continue;

            const price = parseFloat(
                match[1].replace(/,/g, "")
            );

            if (
                Number.isFinite(price) &&
                Math.abs(price - targetPrice) < 0.01
            ) {
                return btn;
            }

        }

        return null;
    }


    function findModalBuyButton() {

        // First modal: button with text "Buy" or "Continue"
        // Often inside a modal dialog with class containing "modal" or "dialog"
        const modals = document.querySelectorAll(
            '[class*="modal"], [class*="dialog"], [role="dialog"]'
        );

        for (const modal of modals) {

            const btn = [
                ...modal.querySelectorAll("button")
            ].find(
                b =>
                    /^(Buy|Continue|Confirm)$/i.test(
                        b.innerText.trim()
                    )
            );
            if (btn) return btn;
        }

        // Fallback: any visible "Buy" button not on main listing row
        return [
            ...document.querySelectorAll("button")
        ].find(
            b =>
                /^Buy$/i.test(b.innerText.trim()) &&
                !b.closest(".market_listing_row, .market_listing, [class*='listing']")
        );

    }


    function waitForSearchResults() {

        return new Promise(resolve => {

            const start = Date.now();
            const timeout = 5000; // 5s - reduced from 15s

            function check() {

                // Check if search results table/rows exist
                const hasResults =
                    document.querySelector("#searchResultsRows") ||
                    document.querySelector("[id*='searchResults']") ||
                    document.querySelector(".market_listing_row") ||
                    document.querySelector("[class*='market_listing']");

                if (hasResults) {
                    // Small delay to let all listings render
                    setTimeout(resolve, 300);
                    return;
                }

                // Check for "no results" message
                const noResults = document.querySelector(".market_noresults, [class*='no_results']");
                if (noResults) {
                    console.log("ℹ️ No results found for this search");
                    resolve();
                    return;
                }

                if (Date.now() - start > timeout) {
                    console.error("⏱️ Timeout waiting for search results");
                    resolve();
                    return;
                }

                requestAnimationFrame(check);
            }

            check();

        });
    }


    function waitForModal(
        label,
        finder
    ) {

        return new Promise(resolve => {

            const start = Date.now();
            const timeout = 5000; // 5s - reduced from 15s

            function check() {

                if (finder()) {
                    resolve();
                    return;
                }

                if (Date.now() - start > timeout) {
                    console.error(
                        `⏱️ Timeout waiting for ${label}`
                    );
                    resolve();
                    return;
                }

                requestAnimationFrame(check);
            }

            check();

        });
    }


    // =========================
    // SCAN
    // =========================

    async function scan(
        gamesWatched,
        signal
    ) {

        const url =
            "https://steamcommunity.com/market/search" +
            "?category_Type=socket_gem" +
            "&appid=570" +
            `&q=games+watched%3A+${gamesWatched}` +
            "&descriptions=1";


        console.log("");

        console.log(
            `🔍 SCANNING: games watched: ${gamesWatched} ` +
            `[${gamesWatched}/${CONFIG.MAX_WATCHED}]`
        );


        // =========================
        // RETRY LOGIC
        // =========================

        for (
            let attempt = 1;
            attempt <= CONFIG.MAX_RETRIES;
            attempt++
        ) {

            try {

                const response =
                    await fetch(
                        url,
                        {
                            credentials: "include",
                            signal
                        }
                    );


                // =========================
                // RATE LIMIT
                // =========================

                if (
                    response.status === 429
                ) {

                    const retryAfter =
                        response.headers.get(
                            "Retry-After"
                        );


                    const delay =
                        retryAfter
                            ? parseInt(
                                retryAfter,
                                10
                            ) * 1000
                            : CONFIG.RETRY_DELAY_MS * attempt;


                    console.log(
                        `⏳ Rate limited. ` +
                        `Retrying in ${delay}ms ` +
                        `(attempt ${attempt}/${CONFIG.MAX_RETRIES})`
                    );


                    await new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                delay
                            )
                    );


                    continue;

                }


                if (!response.ok) {

                    throw new Error(
                        `HTTP ${response.status}`
                    );

                }


                const html =
                    await response.text();


                const result =
                    extractListings(
                        html
                    );


                console.log(
                    `💰 Prices found: ` +
                    `${result.listings.length}`
                );


                if (
                    !result.listings.length
                ) {

                    return "empty";

                }


                // =========================
                // SORT ALL LISTINGS
                // =========================

                const sortedListings =
                    [
                        ...result.listings
                    ].sort(
                        (a, b) =>
                            a.price - b.price
                    );


                // =========================
                // ALL UNDER ₱200
                // =========================

                const cheapListings =
                    sortedListings.filter(
                        listing =>
                            listing.price <
                            CONFIG.MIN_PRICE
                    );


                // =========================
                // LOG CHEAP LISTINGS (GROUPED)
                // =========================

                if (
                    cheapListings.length
                ) {

                    const priceGroups =
                        groupByPrice(
                            cheapListings
                        );

                    priceGroups.forEach(
                        group => {

                            console.log(
                                `💵 [${group.count}] ` +
                                `₱${group.price.toFixed(2)}`
                            );

                        }
                    );

                }


                // =========================
                // UPDATE TRACKERS
                // =========================

                const trackerResults =
                    updateTrackers(
                        cheapListings,
                        gamesWatched
                    );


                // =========================
                // GENERAL TOP 100
                // =========================

                if (
                    trackerResults.general.changed
                ) {

                    displayNewEntries(
                        "",
                        trackerResults.general.newEntries
                    );

                }


                // =========================
                // 100+ / 1000+
                // =========================

                if (
                    trackerResults.watched100.changed
                ) {

                    displayNewEntries(
                        TRACKERS.watched100.label,
                        trackerResults.watched100.newEntries
                    );

                }


                if (
                    trackerResults.watched1000.changed
                ) {

                    displayNewEntries(
                        TRACKERS.watched1000.label,
                        trackerResults.watched1000.newEntries
                    );

                }


                // =========================
                // STOP + BUY AT OR BELOW ₱50
                // =========================

                const stopListings =
                    cheapListings.filter(
                        listing =>
                            listing.price <=
                            CONFIG.STOP_PRICE
                    );


                if (
                    stopListings.length
                ) {

                    // cheapListings is already
                    // sorted lowest → highest.

                    const lowest =
                        stopListings[0];


                    console.log("");

                    console.log(
                        "🛑 STOP PRICE FOUND!"
                    );


                    console.log(
                        `💰 Cheapest: ₱${lowest.price.toFixed(2)}`
                    );


                    console.log(
                        `🎮 Games watched: ${gamesWatched}`
                    );


                    // =========================
                    // DISPLAY TOP 5 LISTS
                    // (only on stop at or below ₱50)
                    // =========================

                    displayTop5(
                        TRACKERS.general.label,
                        TRACKERS.general.key
                    );


                    displayTop5(
                        TRACKERS.watched100.label,
                        TRACKERS.watched100.key
                    );


                    displayTop5(
                        TRACKERS.watched1000.label,
                        TRACKERS.watched1000.key
                    );


                    const stopRecord = {

                        price:
                            lowest.price,

                        gamesWatched,

                        timestamp:
                            new Date().toISOString()

                    };


                    localStorage.setItem(
                        STORAGE_KEYS.STOP,
                        JSON.stringify(
                            stopRecord
                        )
                    );


                    // =========================
                    // STOP SCANNER FIRST
                    // =========================

                    window.steamWatchScannerRunning =
                        false;


                    console.log(
                        "🛑 Scanner stopped."
                    );


                    // =========================
                    // OPEN BUY FLOW
                    // =========================

                    await openBuyFlow(
                        gamesWatched,
                        lowest.price
                    );


                    return "stopped";

                }


                // =========================
                // ₱200+ ONLY
                // =========================

                if (
                    !cheapListings.length
                ) {

                    console.log(
                        `💵 Lowest listing: ` +
                        `₱${sortedListings[0].price.toFixed(2)}`
                    );

                }


                return "success";


            } catch (error) {

                // AbortController/manual stop
                if (
                    error.name === "AbortError"
                ) {

                    return "stopped";

                }


                console.error(
                    "❌ Scan error:",
                    error
                );


                if (
                    attempt >= CONFIG.MAX_RETRIES
                ) {

                    return "error";

                }


                const delay =
                    CONFIG.RETRY_DELAY_MS *
                    attempt;


                console.log(
                    `⏳ Retrying in ${delay}ms ` +
                    `(attempt ${attempt}/${CONFIG.MAX_RETRIES})`
                );


                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            delay
                        )
                );

            }

        }


        return "error";

    }


    // =========================
    // MAIN LOOP
    // =========================

    async function run() {

        const controller =
            new AbortController();

        const { signal } =
            controller;


        // =========================
        // GRACEFUL SHUTDOWN
        // =========================

        const handleStop = () => {

            controller.abort();

            window.steamWatchScannerRunning =
                false;

        };


        // =========================
        // MANUAL STOP COMMAND
        // =========================

        window.stopScanner =
            handleStop;


        let current =
            loadCounter();


        console.log("");

        console.log(
            "🚀 Steam Games Watched Scanner started."
        );


        console.log(
            `📌 Starting at: ${current}`
        );


        console.log(
            `📌 Range: ${CONFIG.MIN_WATCHED} → ${CONFIG.MAX_WATCHED}`
        );


        console.log(
            `📌 Tracker size: ${CONFIG.TRACKER_SIZE}`
        );


        console.log(
            `📌 Max price: ₱${CONFIG.MIN_PRICE}`
        );


        console.log(
            `📌 Stop price: ₱${CONFIG.STOP_PRICE} or below`
        );


        console.log(
            "📌 100+ tracker: 100–999 watched"
        );


        console.log(
            "📌 1000+ tracker: 1000+ watched"
        );


        console.log(
            "📌 Auto Buy flow: ENABLED"
        );


        console.log(
            "📌 Maximum auto-selected price: ₱${CONFIG.STOP_PRICE}"
        );


        console.log(
            "📌 Type stopScanner() in console to stop"
        );


        // =========================
        // SCANNER LOOP
        // =========================

        while (
            window.steamWatchScannerRunning
        ) {

            const result =
                await scan(
                    current,
                    signal
                );


            if (
                result === "stopped"
            ) {

                break;

            }


            // =========================
            // NEXT WATCHED VALUE
            // =========================

            current++;


            if (
                current > CONFIG.MAX_WATCHED
            ) {

                current =
                    CONFIG.MIN_WATCHED;

            }


            saveCounter(
                current
            );


            // =========================
            // SMART DELAY
            // =========================

            let delay =
                CONFIG.NORMAL_DELAY_MS;


            if (
                result === "empty"
            ) {

                delay =
                    CONFIG.EMPTY_DELAY_MS;

            }


            if (
                result === "error"
            ) {

                delay =
                    CONFIG.ERROR_DELAY_MS;

            }


            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        delay
                    )
            );

        }


        console.log("");

        console.log(
            "⏹️ Scanner loop ended."
        );

    }


    // =========================
    // START
    // =========================

    run();

})();


/*
========================================
MANUAL CONTROLS
========================================


STOP
----------------------------------------

window.steamWatchScannerRunning = false;


OR:

stopScanner();


========================================
CHECK COUNTER
========================================

console.log(
    localStorage.getItem(
        "steam_games_watched_counter"
    )
);


========================================
VIEW GENERAL TOP 100
========================================

console.table(
    JSON.parse(
        localStorage.getItem(
            "steam_top20_under_200"
        ) || "[]"
    )
);


========================================
VIEW 100–999 TOP 100
========================================

console.table(
    JSON.parse(
        localStorage.getItem(
            "steam_cheapest_100_plus"
        ) || "[]"
    )
);


========================================
VIEW 1000+ TOP 100
========================================

console.table(
    JSON.parse(
        localStorage.getItem(
            "steam_cheapest_1000_plus"
        ) || "[]"
    )
);


========================================
VIEW STOP RECORD
========================================

console.log(
    JSON.parse(
        localStorage.getItem(
            "steam_stopped_under_50"
        ) || "null"
    )
);


========================================
CLEAR GENERAL TOP 100
========================================

localStorage.removeItem(
    "steam_top20_under_200"
);


========================================
CLEAR 100–999 TRACKER
========================================

localStorage.removeItem(
    "steam_cheapest_100_plus"
);


========================================
CLEAR 1000+ TRACKER
========================================

localStorage.removeItem(
    "steam_cheapest_1000_plus"
);


========================================
CLEAR STOP RECORD
========================================

localStorage.removeItem(
    "steam_stopped_under_50"
);


========================================
RESET COUNTER
========================================

localStorage.removeItem(
    "steam_games_watched_counter"
);

location.reload();


========================================
CLEAR EVERYTHING
========================================

localStorage.removeItem(
    "steam_games_watched_counter"
);

localStorage.removeItem(
    "steam_top20_under_200"
);

localStorage.removeItem(
    "steam_cheapest_100_plus"
);

localStorage.removeItem(
    "steam_cheapest_1000_plus"
);

localStorage.removeItem(
    "steam_stopped_under_50"
);

location.reload();

========================================
*/