package uk.thewyj.app.core.web

enum class WebLoadAction { NONE, LOAD, NAVIGATE, RELOAD }

/** Browser history is observation, not a second native navigation command. */
class WebLoadPolicy(initialSessionEpoch: Int) {
    private var navigationEpoch: Int? = null
    private var sessionEpoch = initialSessionEpoch

    fun next(navigation: Int, session: Int, alreadyAtTarget: Boolean): WebLoadAction {
        val navigate = navigationEpoch != navigation
        val coldStart = navigationEpoch == null
        val refresh = sessionEpoch != session
        navigationEpoch = navigation
        sessionEpoch = session
        return when {
            coldStart -> WebLoadAction.LOAD
            refresh && navigate && !alreadyAtTarget -> WebLoadAction.LOAD
            refresh -> WebLoadAction.RELOAD
            navigate && !alreadyAtTarget -> WebLoadAction.NAVIGATE
            else -> WebLoadAction.NONE
        }
    }
}
