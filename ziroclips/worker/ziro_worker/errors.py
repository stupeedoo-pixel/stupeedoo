class UserFacingError(Exception):
    """An error whose message is safe and helpful to show the user verbatim.

    `retryable=False` means re-running won't help (bad input, quota), so the job
    fails immediately instead of burning attempts.
    """

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable
