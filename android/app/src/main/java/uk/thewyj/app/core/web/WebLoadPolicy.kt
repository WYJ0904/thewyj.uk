package uk.thewyj.app.core.web

enum class WebLoadAction { NONE, LOAD, RELOAD }

/** Browser history is observation, not a second native navigation command. */
class WebLoadPolicy(initialSessionEpoch: Int) {
    private var navigationEpoch: Int? = null
    private var sessionEpoch = initialSessionEpoch

    fun next(navigation: Int, session: Int, alreadyAtTarget: Boolean): WebLoadAction {
        val navigate = navigationEpoch != navigation
        val refresh = sessionEpoch != session
        navigationEpoch = navigation
        sessionEpoch = session
        return when {
            navigate && !alreadyAtTarget -> WebLoadAction.LOAD
            refresh -> WebLoadAction.RELOAD
            else -> WebLoadAction.NONE
        }
    }
}
