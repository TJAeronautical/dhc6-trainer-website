package com.dhc6trainer.feature.knowledge.ui.screens

// Reduced fixture mirroring the structure of SystemDetailScreen.kt (test data
// only, invented strings). The build reads: systemOverview(),
// systemDetailReferenceImages() and systemReferenceNote() including its
// $sourceType else branch.

private data class SystemDetailReferenceImage(val label: String, val assetPath: String)

private data class SystemReferenceNote(
    val description: String,
    val whyImportant: String,
    val howToUse: String,
    val studyFocus: List<String> = emptyList(),
    val oralExamCue: String = ""
)

private fun systemDetailReferenceImages(system: AircraftSystem): List<SystemDetailReferenceImage> = when (system) {
    AircraftSystem.ATA_100 -> listOf(
        SystemDetailReferenceImage("Manual structure reference", "models/systems_lab/fixture/Refs/Figure_0-0.png")
    )
    AircraftSystem.FUEL -> listOf(
        SystemDetailReferenceImage("Fuel system flow", "systems/posters/fuel_system_flow_interactive.webp"),
        SystemDetailReferenceImage("Fuel heater", "systems/posters/fuel_heater.webp")
    )
    AircraftSystem.ELECTRICAL -> listOf(SystemDetailReferenceImage("Electrical system", "systems/posters/electrical_system.webp"))
    AircraftSystem.POWERPLANT -> listOf(
        SystemDetailReferenceImage("Powerplant cutaway", "systems/posters/powerplant_engine_cutaway.webp")
    )
    AircraftSystem.LIMITATIONS -> listOf(
        SystemDetailReferenceImage("Figure 0.1 — Performance reference", "models/systems_lab/fixture/Refs/Figure_0.1.png")
    )
    else -> emptyList()
}

private fun systemReferenceNote(
    system: AircraftSystem,
    reference: SystemDetailReferenceImage
): SystemReferenceNote {
    val label = reference.label.lowercase()
    val path = reference.assetPath.lowercase()
    return when (system) {
        AircraftSystem.POWERPLANT -> SystemReferenceNote(
            description = "Fixture description for the powerplant reference.",
            whyImportant = "Fixture consequence line.",
            howToUse = "Fixture how-to line.",
            studyFocus = listOf(
                "Fixture focus one.",
                "Fixture focus two."
            ),
            oralExamCue = "Fixture oral cue."
        )
        AircraftSystem.FUEL -> SystemReferenceNote(
            description = "Fixture description for the fuel reference.",
            whyImportant = "Fixture fuel consequence.",
            howToUse = "Fixture fuel how-to.",
            studyFocus = listOf("Fixture fuel focus."),
            oralExamCue = "Fixture fuel cue."
        )
        else -> {
            val sourceType = when {
                label.contains("figure") || path.contains("refs/") -> "manual figure/reference image"
                path.contains("poster") -> "system poster"
                path.contains("map") -> "system map"
                else -> "bundled reference image"
            }
            SystemReferenceNote(
                description = "This $sourceType is included to give a visual anchor.",
                whyImportant = "Fixture generic consequence.",
                howToUse = "Fixture generic how-to.",
                studyFocus = listOf("Fixture generic focus."),
                oralExamCue = "Fixture generic cue."
            )
        }
    }
}

private fun systemOverview(system: AircraftSystem): String =
    when (system) {
        AircraftSystem.GENERAL -> "Fixture overview: general."
        AircraftSystem.ATA_100 -> "Fixture overview: manual structure."
        AircraftSystem.LIMITATIONS -> "Fixture overview: limitations."
        AircraftSystem.POWERPLANT -> "Fixture overview: powerplant."
        AircraftSystem.FUEL -> "Fixture overview: fuel."
        AircraftSystem.ELECTRICAL -> "Fixture overview: electrical."
        AircraftSystem.ICE_RAIN_PROTECTION -> "Fixture overview: ice and rain."
    }
