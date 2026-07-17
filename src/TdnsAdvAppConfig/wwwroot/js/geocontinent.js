(function () {
    "use strict";

    window.initGeoGroupApp({
        tabKey: "geocontinent",
        idPrefix: "gcn",
        paneId: "mainTabPaneGeoContinent",
        configRootId: "gcnConfigRoot",
        recordsRootId: "gcnRecordsRoot",
        apiBase: "/api/geocontinent",
        appLabel: "Geo Continent",
        keyLabel: "Continent Code",
        keyNoun: "continent",
        codePlaceholder: "e.g. NA or AS1234",
        classPathAddress: "GeoContinent.Address",
        classPathCname: "GeoContinent.CNAME",
        codeOptions: [
            { code: "AF", label: "Africa" },
            { code: "AN", label: "Antarctica" },
            { code: "AS", label: "Asia" },
            { code: "EU", label: "Europe" },
            { code: "NA", label: "North America" },
            { code: "OC", label: "Oceania" },
            { code: "SA", label: "South America" }
        ]
    });
})();
